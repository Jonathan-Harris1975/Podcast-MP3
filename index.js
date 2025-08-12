import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import logger from './utils/logger.js';
import { processURLsToMergedTTS } from './utils/ttsProcessor.js';
import { createPodcast } from './utils/podcastProcessor.js';
import { r2merged } from './utils/r2merged.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// Environment Validation
// ======================
async function validateEnvironment() {
  const errors = [];

  if (!process.env.R2_BUCKET_CHUNKS_MERGED || !process.env.R2_PUBLIC_BASE_URL_CHUNKS_MERGED) {
    errors.push('R2 merged bucket or public URL not configured');
    logger.error('Base R2 chunks bucket validation failed', {
      R2_BUCKET_CHUNKS_MERGED: process.env.R2_BUCKET_CHUNKS_MERGED,
      R2_PUBLIC_BASE_URL_CHUNKS_MERGED: process.env.R2_PUBLIC_BASE_URL_CHUNKS_MERGED,
    });
  }

  if (process.env.RENDER) {
    try {
      await execPromise('ffmpeg -version && ffprobe -version');
      logger.info('FFmpeg and FFprobe verified');
    } catch (err) {
      errors.push('FFmpeg/FFprobe not available');
      logger.error('FFmpeg verification failed', { error: err.message });
    }
  }

  if (errors.length > 0) {
    errors.forEach(err => logger.error('Environment validation error:', err));
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
    } catch {
      logger.error('Invalid JSON payload', {
        path: req.path,
        ip: req.ip,
        bodySample: buf.toString().slice(0, 200)
      });
      res.status(400).json({ error: 'Invalid JSON format' });
      throw new Error('Invalid JSON'); // To stop further processing
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
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '3.0.3',
    services: {
      r2: !!process.env.R2_ENDPOINT,
      ffmpeg: true,
      tts: true,
      podcast: !!process.env.R2_BUCKET_PODCAST
    }
  });
});

app.post('/process', apiLimiter, async (req, res) => {
  const startTime = Date.now();
  const { sessionId, urls, options = {} } = req.body;

  if (!sessionId?.match(/^TT-\d{4}-\d{2}-\d{2}/)) {
    return res.status(400).json({ error: 'Invalid sessionId format (expected TT-YYYY-MM-DD)' });
  }

  if (!Array.isArray(urls)) {
    return res.status(400).json({ error: 'URLs must be provided as an array' });
  }

  try {
    const result = await processURLsToMergedTTS(
      urls,
      sessionId,
      {
        voice: options.voice || process.env.DEFAULT_VOICE,
        speakingRate: options.speakingRate || process.env.DEFAULT_SPEAKING_RATE,
        pitch: options.pitch || process.env.DEFAULT_PITCH
      }
    );

    return res.json({
      success: true,
      sessionId: result.sessionId,
      chunks: result.chunks?.map((url, index) => ({
        index,
        url,
        bytesApprox: 0
      })) || [],
      mergedUrl: result.mergedUrl,
      processingTimeMs: Date.now() - startTime
    });
  } catch (error) {
    logger.error('TTS processing failed', error);
    return res.status(500).json({
      error: 'TTS processing failed',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

app.post('/podcast', apiLimiter, async (req, res) => {
  const startTime = Date.now();
  const { sessionId } = req.body;

  if (!sessionId?.match(/^TT-\d{4}-\d{2}-\d{2}/)) {
    return res.status(400).json({ error: 'Invalid sessionId format (expected TT-YYYY-MM-DD)' });
  }

  try {
    const mergedUrl = `${process.env.R2_PUBLIC_BASE_URL_CHUNKS_MERGED}/${sessionId}/merged.mp3`;
    const podcastResult = await createPodcast(
      sessionId,
      mergedUrl,
      process.env.DEFAULT_INTRO_URL,
      process.env.DEFAULT_OUTRO_URL
    );

    return res.json({
      success: true,
      sessionId,
      podcastUrl: podcastResult.url,
      duration: podcastResult.duration,
      fileSize: podcastResult.size,
      fileSizeHuman: podcastResult.sizeMB,
      uuid: podcastResult.uuid,
      technicalDetails: podcastResult.technicalDetails,
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
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
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
        r2: !!process.env.R2_ENDPOINT
      }
    });
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received - shutting down gracefully');
    server.close(() => process.exit(0));
  });

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
