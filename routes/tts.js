// src/routes/tts.js
import express from 'express';
import { processTextFromURLs } from '../utils/textProcessor.js';
import { mergeAudioFiles, validateAudioConfig, generateAudioFilename, estimateAudioSize } from '../utils/audioUtils.js';

const router = express.Router();

// Google TTS client (you'll need to configure this based on your setup)
let ttsClient;
try {
    // Import Google TTS if available
    const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
    ttsClient = new TextToSpeechClient();
} catch (error) {
    console.warn('Google TTS client not available:', error.message);
}

/**
 * POST /chunked - Main TTS chunked endpoint
 * Processes long text into SSML-safe chunks and generates TTS audio
 */
router.post('/chunked', async (req, res) => {
    try {
        const {
            text,
            voice = { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
            audioConfig = { audioEncoding: 'MP3', speakingRate: 1.0 },
            concurrency = 3,
            R2_BUCKET = process.env.R2_BUCKET_CHUNKS, // Default to chunks bucket
            R2_PREFIX,
            returnBase64 = false,
            urls = []
        } = req.body;

        // Validate required parameters
        if (!text && (!urls || urls.length === 0)) {
            return res.status(400).json({
                error: 'Either "text" or "urls" parameter is required',
                timestamp: new Date().toISOString()
            });
        }

        // Validate audio configuration
        const audioValidation = validateAudioConfig(audioConfig);
        if (!audioValidation.valid) {
            return res.status(400).json({
                error: 'Invalid audio configuration',
                details: audioValidation.errors,
                timestamp: new Date().toISOString()
            });
        }

        let processedText = text;
        
        // Process URLs if provided
        if (urls && urls.length > 0) {
            const urlResult = await processTextFromURLs(urls);
            if (urlResult.success) {
                processedText = urlResult.text;
            } else {
                return res.status(400).json({
                    error: 'Failed to process URLs',
                    details: urlResult.errors,
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Chunk the text for TTS processing
        const maxChunkSize = parseInt(process.env.MAX_SSML_CHUNK_BYTES) || 3400;
        const chunks = chunkTextForTTS(processedText, maxChunkSize);
        
        if (chunks.length === 0) {
            return res.status(400).json({
                error: 'No valid text chunks to process',
                timestamp: new Date().toISOString()
            });
        }

        // Process TTS for each chunk
        const audioResults = [];
        const semaphore = new Semaphore(concurrency);
        
        const processingPromises = chunks.map(async (chunk, index) => {
            return semaphore.acquire().then(async (release) => {
                try {
                    const audioBuffer = await generateTTSAudio(chunk, voice, audioConfig);
                    
                    let url = null;
                    let base64 = null;
                    
                    if (returnBase64) {
                        base64 = audioBuffer.toString('base64');
                    } else {
                        // Upload to R2 or GCS
                        url = await uploadAudio(audioBuffer, {
                            bucket: R2_BUCKET,
                            prefix: R2_PREFIX,
                            filename: generateAudioFilename(R2_PREFIX || 'chunk', index, audioConfig.audioEncoding)
                        });
                    }
                    
                    return {
                        index,
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
                failedChunks,
                timestamp: new Date().toISOString()
            });
        }

        const totalBytes = successfulResults.reduce((sum, chunk) => sum + chunk.bytesApprox, 0);

        const response = {
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

        res.json(response);

    } catch (error) {
        console.error('TTS processing error:', error);
        res.status(500).json({
            error: 'Internal server error during TTS processing',
            message: process.env.NODE_ENV === 'production' ? undefined : error.message,
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
            gcsStorage: !!process.env.GCS_BUCKET
        },
        timestamp: new Date().toISOString()
    };

    res.json(status);
});

/**
 * Utility function to chunk text for TTS processing
 */
function chunkTextForTTS(text, maxLength = 5000) {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        const trimmedSentence = sentence.trim();
        
        if (currentChunk.length + trimmedSentence.length + 1 <= maxLength) {
            currentChunk += (currentChunk ? '. ' : '') + trimmedSentence;
        } else {
            if (currentChunk) {
                chunks.push(currentChunk + '.');
            }
            
            // Handle very long sentences
            if (trimmedSentence.length > maxLength) {
                const words = trimmedSentence.split(' ');
                let wordChunk = '';
                
                for (const word of words) {
                    if (wordChunk.length + word.length + 1 <= maxLength) {
                        wordChunk += (wordChunk ? ' ' : '') + word;
                    } else {
                        if (wordChunk) {
                            chunks.push(wordChunk);
                        }
                        wordChunk = word;
                    }
                }
                
                if (wordChunk) {
                    currentChunk = wordChunk;
                } else {
                    currentChunk = '';
                }
            } else {
                currentChunk = trimmedSentence;
            }
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk + '.');
    }

    return chunks.filter(chunk => chunk.trim().length > 0);
}

/**
 * Generate TTS audio for a text chunk
 */
async function generateTTSAudio(text, voice, audioConfig) {
    if (!ttsClient) {
        throw new Error('Google TTS client not available');
    }

    try {
        const request = {
            input: { text },
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
 * Upload audio to cloud storage (R2 or GCS)
 */
async function uploadAudio(audioBuffer, options) {
    const { bucket, prefix, filename } = options;

    try {
        // R2 upload (preferred)
        if (process.env.R2_ACCESS_KEY_ID && bucket) {
            return await uploadToR2(audioBuffer, bucket, `${prefix}/${filename}`);
        }
        
        // GCS fallback
        if (process.env.GCS_BUCKET) {
            return await uploadToGCS(audioBuffer, process.env.GCS_BUCKET, `${prefix}/${filename}`);
        }

        throw new Error('No storage configuration available');
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
    
    // In production, you would use AWS SDK v3 to actually upload
    // For now, return the expected URL structure
    return `${baseUrl}/${key}`;
}

/**
 * Upload to Google Cloud Storage
 */
async function uploadToGCS(audioBuffer, bucket, filename) {
    // Placeholder - implement with @google-cloud/storage
    return `https://storage.googleapis.com/${bucket}/${filename}`;
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
                    if (this.queue.length > 0) {
                        const next = this.queue.shift();
                        this.current++;
                        next(() => {
                            this.current--;
                            this.processQueue();
                        });
                    }
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
