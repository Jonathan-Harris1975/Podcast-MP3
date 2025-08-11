import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import logger from './utils/logger.js';
import { processURLsToMergedTTS } from './utils/ttsProcessor.js';
import { createPodcast } from './utils/podcastProcessor.js';
import { uploadToR2Merged } from './utils/r2merged.js';
import * as r2 from './utils/r2.js'; // <-- added import
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

  // Generic R2 bucket connection check
  if (!(await r2.testConnection?.())) {
    errors.push('Base R2 configuration invalid');
    logger.error('Base R2 configuration validation failed');
  }

  // Merged-bucket specific check
  if (!(await uploadToR2Merged())) {
    errors.push('R2 merged storage configuration invalid');
    logger.error('R2 merged storage validation failed');
  }

  // FFmpeg availability check (Render only)
  if (process.env.RENDER) {
    try {
      await execPromise('ffmpeg -version && ffprobe -version');
    } catch (err) {
      errors.push('FFmpeg/FFprobe not available');
      logger.error('FFmpeg verification failed', { error: err.message });
    }
  }

  if (errors.length > 0) {
    logger.error('Environment validation failed', { errors });
    process.exit(1);
  }
}
