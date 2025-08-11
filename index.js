import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import logger from './utils/logger.js';
import { processURLsToMergedTTS } from './utils/ttsProcessor.js';
import { createPodcast } from './utils/podcastProcessor.js';
import { checkR2Config } from './utils/r2merged.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import healthcheck from 'express-healthcheck';

const execPromise = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// Environment Validation
// ======================
async function validateEnvironment() {
  const errors = [];

  if (!(await checkR2Config())) {
    errors.push('R2 configuration invalid');
    logger.error('R2 configuration validation failed');
  }

  if (process.env.RENDER) {
    try {
      await execPromise('ffmpeg -version && ffprobe -version');
    } catch (err) {
      errors.push('FFmpeg/FFprobe not available');
      logger.error('FFmpeg verification failed', { error: err.message });
    }
  }

  if (errors.length > 0) {
    process.exit(1);
  }
}

// ======================
// Middleware
// ======================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://*.r2.dev"],
      mediaSrc: ["'self'", "https://*.r2.dev"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({
  limit: process.env.MAX_REQUEST_SIZE || '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      logger.error('Invalid JSON payload', {
        path: req.path,
        ip: req.ip,
        bodySample: buf.toString().substring(0, 200)
      });
      res.status(400).json({ error: 'Invalid JSON format' });
    }
  }
}));

// ======================
// Rate Limiting
// ======================
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded',
    retryAfter: '15 minutes'
  }
});

// ======================
// API Endpoints
// ======================
app.use('/health', healthcheck({
  healthy: function() {
    return { 
      status: 'healthy',
      version: process.env.npm_package_version,
      services: {
        r2: true,
        ffmpeg: true,
        tts: true,
        podcast: true
      },
      timestamp: new Date().toISOString()
    };
  }
}));

// Main TTS Processing Endpoint
app.post('/api/process', apiLimiter, async (req, res) => {
  const startTime = Date.now();
  const { sessionId, urls, options = {} } = req.body;

  try {
    // Enhanced validation
    if (!sessionId?.match(/^TT-\d{4}-\d{2}-\d{2}/)) {
      logger.warn('Invalid sessionId format', { sessionId });
      return res.status(400).json({
        error: 'Invalid sessionId format',
        expectedFormat: 'TT-YYYY-MM-DD',
        example: 'TT-2025-08-11'
      });
    }

    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({
        error: 'URLs must be provided as an array',
        example: {
          sessionId: "TT-2025-08-11",
          urls: ["https://example.com/text1.txt"]
        }
      });
    }

    if (urls.length > parseInt(process.env.MAX_URLS_PER_REQUEST || '10')) {
      return res.status(400).json({
        error: `Maximum ${process.env.MAX_URLS_PER_REQUEST || 10} URLs per request exceeded`
      });
    }

    logger.info('Processing TTS request', { sessionId, urlCount: urls.length });

    const result = await processURLsToMergedTTS(
      urls,
      sessionId,
      {
        voice: options.voice || process.env.DEFAULT_VOICE,
        speakingRate: options.speakingRate || process.env.DEFAULT_SPEAKING_RATE,
        pitch: options.pitch || process.env.DEFAULT_PITCH
      }
    );

    logger.info('TTS processing completed', {
      sessionId,
      processingTimeMs: Date.now() - startTime,
      chunkCount: result.chunks.length
    });

    return res.json({
      success: true,
      sessionId: result.sessionId,
      chunks: result.chunks.map((url, index) => ({
        index,
        url,
        bytesApprox: 0 // Replace with actual if available
      })),
      mergedUrl: result.mergedUrl,
      processingTimeMs: Date.now() - startTime
    });

  } catch (error) {
    logger.error('TTS processing failed', {
      error: error.message,
      stack: error.stack,
      sessionId
    });
    
    return res.status(500).json({
      error: 'TTS processing failed',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

// Podcast Creation Endpoint
app.post('/podcast', apiLimiter, async (req, res) => {
  const startTime = Date.now();
  const { sessionId, introUrl, outroUrl } = req.body;

  try {
    // Validation
    if (!sessionId?.match(/^TT-\d{4}-\d{2}-\d{2}/)) {
      return res.status(400).json({
        error: 'Invalid sessionId format (expected TT-YYYY-MM-DD)'
      });
    }

    const mergedUrl = `${process.env.R2_PUBLIC_BASE_URL_CHUNKS_MERGED}/${sessionId}/merged.mp3`;
    const podcastResult = await createPodcast(
      sessionId,
      mergedUrl,
      introUrl || process.env.DEFAULT_INTRO_URL,
      outroUrl || process.env.DEFAULT_OUTRO_URL
    );

    logger.info('Podcast created successfully', {
      sessionId,
      duration: podcastResult.duration,
      size: podcastResult.sizeMB,
      processingTimeMs: Date.now() - startTime
    });

    return res.json({
      success: true,
      sessionId,
      podcastUrl: podcastResult.url,
      duration: podcastResult.duration,
      fileSize: podcastResult.size,
      fileSizeHuman: podcastResult.sizeMB,
      components: {
        merged: mergedUrl,
        intro: introUrl || process.env.DEFAULT_INTRO_URL,
        outro: outroUrl || process.env.DEFAULT_OUTRO_URL
      },
      processingTimeMs: Date.now() - startTime
    });

  } catch (error) {
    logger.error('Podcast creation failed', {
      error: error.message,
      sessionId,
      stack: error.stack
    });
    
    return res.status(500).json({
      error: 'Podcast creation failed',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      suggestion: 'Check that the sessionId exists and intro/outro URLs are valid'
    });
  }
});

// ======================
// Server Initialization
// ======================
async function startServer() {
  await validateEnvironment();

  const server = app.listen(PORT, () => {
    logger.info(`TTS Service running on port ${PORT}`, {
      environment: process.env.NODE_ENV || 'development',
      features: {
        podcast: !!process.env.R2_BUCKET_PODCAST,
        tts: true,
        r2: true
      },
      limits: {
        maxUrls: process.env.MAX_URLS_PER_REQUEST || 10,
        rateLimit: process.env.RATE_LIMIT_MAX || 100
      }
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received - shutting down gracefully');
    server.close(() => {
      logger.info('Server terminated');
      process.exit(0);
    });
  });

  // Error handling
  process.on('unhandledRejection', (err) => {
    logger.error('Unhandled rejection', err);
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
    process.exit(1);
  });
}

startServer().catch(err => {
  logger.error('Server startup failed', err);
  process.exit(1);
});
