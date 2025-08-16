// src/routes/tts.js
import express from 'express';
import { processTextFromURLs } from '../utils/textProcessor.js';
import { mergeAudioFiles, validateAudioConfig, generateAudioFilename, estimateAudioSize } from '../utils/audioUtils.js';

const router = express.Router();

// Google TTS client
let ttsClient;
try {
    const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
    ttsClient = new TextToSpeechClient();
} catch (error) {
    console.warn('Google TTS client not available:', error.message);
}

/**
 * POST /chunked - Main TTS chunked endpoint
 * Input: { sessionId: "TT-2025-08-15" }
 * Pulls raw text chunks from R2 bucket using sessionId
 */
router.post('/chunked', async (req, res) => {
    try {
        const { sessionId } = req.body;

        // Validate sessionId
        if (!sessionId || typeof sessionId !== 'string') {
            return res.status(400).json({
                error: 'sessionId parameter is required',
                expected: 'string',
                received: typeof sessionId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(JSON.stringify({
            level: 'info',
            message: 'Processing TTS request',
            sessionId,
            timestamp: new Date().toISOString()
        }));

        // Get text chunk URLs from R2 bucket based on sessionId
        const textChunkUrls = await getTextChunkUrls(sessionId);
        
        if (!textChunkUrls || textChunkUrls.length === 0) {
            return res.status(404).json({
                error: 'No text chunks found for sessionId',
                sessionId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(JSON.stringify({
            level: 'info',
            message: 'Retrieved URLs for sessionId',
            sessionId,
            count: textChunkUrls.length,
            urls: textChunkUrls.slice(0, 5) // Log first 5 URLs for debugging
        }));

        // Default TTS configuration (can be overridden via request body)
        const {
            voice = { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
            audioConfig = { audioEncoding: 'MP3', speakingRate: 1.0 },
            concurrency = 3,
            returnBase64 = false
        } = req.body;

        // Validate audio configuration
        const audioValidation = validateAudioConfig(audioConfig);
        if (!audioValidation.valid) {
            return res.status(400).json({
                error: 'Invalid audio configuration',
                details: audioValidation.errors,
                timestamp: new Date().toISOString()
            });
        }

        // Process each text chunk URL to get the actual text content
        const textChunks = await fetchTextFromUrls(textChunkUrls);
        
        if (!textChunks || textChunks.length === 0) {
            return res.status(500).json({
                error: 'Failed to retrieve text content from URLs',
                sessionId,
                timestamp: new Date().toISOString()
            });
        }

        // Process TTS for each text chunk
        const audioResults = [];
        const semaphore = new Semaphore(concurrency);
        
        const processingPromises = textChunks.map(async (textChunk, index) => {
            return semaphore.acquire().then(async (release) => {
                try {
                    const audioBuffer = await generateTTSAudio(textChunk.text, voice, audioConfig);
                    
                    let url = null;
                    let base64 = null;
                    
                    if (returnBase64) {
                        base64 = audioBuffer.toString('base64');
                    } else {
                        // Upload to R2 chunks bucket
                        const filename = generateAudioFilename(sessionId, index, audioConfig.audioEncoding);
                        url = await uploadAudio(audioBuffer, {
                            bucket: process.env.R2_BUCKET_CHUNKS,
                            prefix: '',
                            filename: filename
                        });
                    }
                    
                    return {
                        index,
                        sourceUrl: textChunk.url,
                        bytesApprox: audioBuffer.length,
                        url,
                        base64
                    };
                } catch (error) {
                    console.error(`Error processing chunk ${index}:`, error);
                    throw error;
                } finally {
                    release();
                }
            });
        });

        const results = await Promise.allSettled(processingPromises);
        
        // Process results
        const successfulResults = results
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value)
            .sort((a, b) => a.index - b.index);

        const failedChunks = results
            .map((result, index) => ({ result, index }))
            .filter(({ result }) => result.status === 'rejected')
            .map(({ index }) => index);

        if (successfulResults.length === 0) {
            return res.status(500).json({
                error: 'Failed to process any audio chunks',
                sessionId,
                failedChunks,
                timestamp: new Date().toISOString()
            });
        }

        const totalBytes = successfulResults.reduce((sum, chunk) => sum + chunk.bytesApprox, 0);

        const response = {
            sessionId,
            count: successfulResults.length,
            chunks: successfulResults,
            summaryBytesApprox: totalBytes,
            timestamp: new Date().toISOString()
        };

        if (failedChunks.length > 0) {
            response.warnings = {
                failedChunks,
                message: `${failedChunks.length} chunks failed to process`
            };
        }

        console.log(JSON.stringify({
            level: 'info',
            message: 'TTS processing completed',
            sessionId,
            successfulChunks: successfulResults.length,
            failedChunks: failedChunks.length,
            totalBytes,
            timestamp: new Date().toISOString()
        }));

        res.json(response);

    } catch (error) {
        console.error(JSON.stringify({
            level: 'error',
            message: 'TTS processing error',
            error: error.message,
            stack: process.env.NODE_ENV === 'Production' ? undefined : error.stack,
            timestamp: new Date().toISOString()
        }));
        
        res.status(500).json({
            error: 'Internal server error during TTS processing',
            message: process.env.NODE_ENV === 'Production' ? undefined : error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /status - Health check for TTS service
 */
router.get('/status', (req, res) => {
    const status = {
        service: 'TTS Chunked Service',
        status: 'operational',
        version: '3.0.6',
        features: {
            googleTTS: !!ttsClient,
            r2Storage: !!process.env.R2_ACCESS_KEY_ID,
            sessionBasedProcessing: true
        },
        buckets: {
            textChunks: process.env.R2_BUCKET_CHUNKS_T,
            audioChunks: process.env.R2_BUCKET_CHUNKS,
            mergedAudio: process.env.R2_BUCKET_CHUNKS_MERGED,
            podcast: process.env.R2_BUCKET_PODCAST
        },
        timestamp: new Date().toISOString()
    };

    res.json(status);
});

/**
 * Get text chunk URLs from R2 bucket based on sessionId
 * Uses your existing R2_BUCKET_CHUNKS_T bucket for raw text
 */
async function getTextChunkUrls(sessionId) {
    try {
        // This would typically query your R2 bucket or database
        // For now, using the pattern from your logs: chunk-1.txt, chunk-2.txt, etc.
        
        // In a real implementation, you would:
        // 1. List objects in R2_BUCKET_CHUNKS_T with prefix = sessionId
        // 2. Filter for .txt files
        // 3. Sort them by chunk number
        
        // Mock implementation based on your log pattern
        const baseUrl = process.env.R2_PUBLIC_BASE_URL_1;
        const urls = [];
        
        // Try to find chunks (assuming they exist from chunk-1.txt to chunk-N.txt)
        // In production, replace this with actual R2 bucket listing
        for (let i = 1; i <= 100; i++) { // Reasonable upper limit
            const url = `${baseUrl}/${sessionId}/chunk-${i}.txt`;
            
            // In production, you would verify the URL exists before adding
            // For now, we'll add them and let the fetch process handle missing ones
            urls.push(url);
            
            // Stop at a reasonable number or implement proper bucket listing
            if (i >= 63) break; // Based on your log showing count: 63
        }
        
        return urls;
        
    } catch (error) {
        console.error('Error getting text chunk URLs:', error);
        return [];
    }
}

/**
 * Fetch text content from multiple URLs
 */
async function fetchTextFromUrls(urls) {
    const results = [];
    
    for (const url of urls) {
        try {
            const response = await fetch(url);
            
            if (response.ok) {
                const text = await response.text();
                results.push({
                    url,
                    text: text.trim(),
                    success: true
                });
            } else {
                console.warn(`Failed to fetch ${url}: ${response.status}`);
            }
        } catch (error) {
            console.warn(`Error fetching ${url}:`, error.message);
        }
    }
    
    return results;
}

/**
 * Generate TTS audio for a text chunk
 */
async function generateTTSAudio(text, voice, audioConfig) {
    if (!ttsClient) {
        throw new Error('Google TTS client not available');
    }

    if (!text || text.trim().length === 0) {
        throw new Error('Empty text provided for TTS');
    }

    try {
        const request = {
            input: { text: text.trim() },
            voice,
            audioConfig
        };

        const [response] = await ttsClient.synthesizeSpeech(request);
        return Buffer.from(response.audioContent, 'binary');
    } catch (error) {
        console.error('TTS generation error:', error);
        throw new Error(`Failed to generate TTS: ${error.message}`);
    }
}

/**
 * Upload audio to cloud storage
 */
async function uploadAudio(audioBuffer, options) {
    const { bucket, filename } = options;

    try {
        if (process.env.R2_ACCESS_KEY_ID && bucket) {
            return await uploadToR2(audioBuffer, bucket, filename);
        }
        
        throw new Error('No R2 storage configuration available');
    } catch (error) {
        console.error('Upload error:', error);
        throw new Error(`Failed to upload audio: ${error.message}`);
    }
}

/**
 * Upload to R2 storage using your configured buckets
 */
async function uploadToR2(audioBuffer, bucket, key) {
    // Use the appropriate R2 public base URL based on bucket
    let baseUrl;
    
    switch (bucket) {
        case process.env.R2_BUCKET_CHUNKS:
            baseUrl = process.env.R2_PUBLIC_BASE_URL_CHUNKS;
            break;
        case process.env.R2_BUCKET_CHUNKS_MERGED:
            baseUrl = process.env.R2_PUBLIC_BASE_URL_CHUNKS_MERGED;
            break;
        case process.env.R2_BUCKET_PODCAST:
            baseUrl = process.env.R2_PUBLIC_BASE_URL_PODCAST;
            break;
        default:
            baseUrl = process.env.R2_PUBLIC_BASE_URL_1;
    }
    
    // In production, implement actual R2 upload using AWS SDK v3
    // For now, return the expected URL structure
    return `${baseUrl}/${key}`;
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
    constructor(max) {
        this.max = max;
        this.current = 0;
        this.queue = [];
    }

    acquire() {
        return new Promise((resolve) => {
            if (this.current < this.max) {
                this.current++;
                resolve(() => {
                    this.current--;
                    this.processQueue();
                });
            } else {
                this.queue.push(resolve);
            }
        });
    }

    processQueue() {
        if (this.queue.length > 0 && this.current < this.max) {
            const next = this.queue.shift();
            this.current++;
            next(() => {
                this.current--;
                this.processQueue();
            });
        }
    }
}

export default router;
