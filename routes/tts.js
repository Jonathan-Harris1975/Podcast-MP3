// src/routes/tts.js - Clean version without circular imports
import express from 'express';

const router = express.Router();

// Google TTS client initialization
let ttsClient = null;

async function initializeTTSClient() {
    try {
        const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
        ttsClient = new TextToSpeechClient();
        console.log('Google TTS client initialized successfully');
    } catch (error) {
        console.warn('Google TTS client not available:', error.message);
    }
}

// Initialize TTS client
initializeTTSClient();

/**
 * POST /chunked - Main TTS chunked endpoint
 * Input: { sessionId: "TT-2025-08-15" }
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

        // Get text chunk URLs based on sessionId
        const baseUrl = process.env.R2_PUBLIC_BASE_URL_1;
        const textChunkUrls = [];
        
        // Generate URLs for text chunks
        for (let i = 1; i <= 63; i++) {
            textChunkUrls.push(`${baseUrl}/${sessionId}/chunk-${i}.txt`);
        }

        console.log(JSON.stringify({
            level: 'info',
            message: 'Retrieved URLs for sessionId',
            sessionId,
            count: textChunkUrls.length,
            urls: textChunkUrls.slice(0, 3) // Log first 3 URLs for debugging
        }));

        // Default configuration
        const {
            voice = { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
            audioConfig = { audioEncoding: 'MP3', speakingRate: 1.0 },
            concurrency = 3,
            returnBase64 = false
        } = req.body;

        // For now, return a success response to test the endpoint
        const response = {
            sessionId,
            status: 'processing_started',
            textChunksFound: textChunkUrls.length,
            configuration: {
                voice,
                audioConfig,
                concurrency,
                returnBase64
            },
            urls: textChunkUrls.slice(0, 5), // Show first 5 URLs
            timestamp: new Date().toISOString()
        };

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
            textChunks: process.env.R2_BUCKET_CHUNKS_T || 'raw-text',
            audioChunks: process.env.R2_BUCKET_CHUNKS || 'podcast-chunks',
            mergedAudio: process.env.R2_BUCKET_CHUNKS_MERGED || 'podcast-merged',
            podcast: process.env.R2_BUCKET_PODCAST || 'podcast'
        },
        baseUrls: {
            textChunks: process.env.R2_PUBLIC_BASE_URL_1,
            audioChunks: process.env.R2_PUBLIC_BASE_URL_CHUNKS,
            mergedAudio: process.env.R2_PUBLIC_BASE_URL_CHUNKS_MERGED,
            podcast: process.env.R2_PUBLIC_BASE_URL_PODCAST
        },
        timestamp: new Date().toISOString()
    };

    res.json(status);
});

/**
 * GET /test - Simple test endpoint
 */
router.get('/test', (req, res) => {
    res.json({
        message: 'TTS routes are working',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Export the router as default
export default router;
