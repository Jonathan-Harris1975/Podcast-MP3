import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from './logger.js';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';

const execPromise = promisify(exec);
const r2PodcastClient = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

export async function createPodcast(sessionId, mergedUrl, introUrl, outroUrl) {
  const tempDir = '/tmp';
  
  try {
    // 1. Download all audio files
    const [mergedPath, introPath, outroPath] = await Promise.all([
      downloadAudio(mergedUrl, path.join(tempDir, `${sessionId}_merged.mp3`)),
      downloadAudio(introUrl, path.join(tempDir, `${sessionId}_intro.mp3`)),
      downloadAudio(outroUrl, path.join(tempDir, `${sessionId}_outro.mp3`))
    ]);

    // 2. Process with professional audio effects
    const outputFile = path.join(tempDir, `${sessionId}_final.mp3`);
    await processWithFading(introPath, mergedPath, outroPath, outputFile);

    // 3. Get audio metadata
    const { duration, size } = await getAudioMetadata(outputFile);

    // 4. Upload to podcast bucket
    const podcastKey = `${sessionId}.mp3`;
    const podcastUrl = await uploadToPodcastBucket(outputFile, podcastKey);

    return {
      url: podcastUrl,
      duration: formatDuration(duration),
      size,
      sizeMB: (size / (1024 * 1024)).toFixed(2) + ' MB'
    };
  } finally {
    // Cleanup temporary files
    await cleanTempFiles(tempDir, sessionId);
  }
}

async function getAudioMetadata(filePath) {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
  const duration = parseFloat(await execPromise(cmd).stdout.trim());
  const stats = await fs.stat(filePath);
  
  return {
    duration,
    size: stats.size
  };
}

function formatDuration(seconds) {
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = Math.floor(seconds % 60);
  
  return [hh, mm, ss]
    .map(v => v.toString().padStart(2, '0'))
    .join(':');
}

// ... (keep existing downloadAudio, processWithFading, uploadToPodcastBucket, cleanTempFiles functions)
