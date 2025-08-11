import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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

// Constants
const INTRO_DURATION = 15; // seconds
const OUTRO_DURATION = 16; // seconds
const FADE_IN_DURATION = 2; // seconds
const CONTENT_FADE_OUT_START = 60; // seconds
const CONTENT_FADE_OUT_DURATION = 3; // seconds

// Generate short TT-prefixed ID (e.g. TT-A5X9F3)
const generateShortId = () => `TT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export async function createPodcast(sessionId, mergedUrl, introUrl, outroUrl) {
  const startTime = Date.now();
  const tempDir = '/tmp/audio-processing';
  await fs.mkdir(tempDir, { recursive: true });

  try {
    // 1. Download all audio components
    const [mergedPath, introPath, outroPath] = await Promise.all([
      downloadAudio(mergedUrl, path.join(tempDir, `${sessionId}_merged.mp3`)),
      downloadAudio(introUrl, path.join(tempDir, `${sessionId}_intro.mp3`)),
      downloadAudio(outroUrl, path.join(tempDir, `${sessionId}_outro.mp3`))
    ]);

    // 2. Validate audio files
    await validateAudioFiles(introPath, outroPath);

    // 3. Process with professional audio effects
    const outputFile = path.join(tempDir, `${sessionId}_final.mp3`);
    await processAudioWithPrecision(introPath, mergedPath, outroPath, outputFile);

    // 4. Get final audio metadata
    const metadata = await getAudioMetadata(outputFile);

    // 5. Upload to podcast bucket
    const podcastKey = `${sessionId}.mp3`;
    const podcastUrl = await uploadToPodcastBucket(outputFile, podcastKey);

    // 6. Generate response
    return {
      success: true,
      sessionId,
      podcastUrl,
      duration: metadata.duration,
      fileSize: metadata.size,
      fileSizeHuman: (metadata.size / (1024 * 1024)).toFixed(2) + ' MB',
      uuid: generateShortId(),
      technicalDetails: {
        bitrate: '192kbps',
        sampleRate: '44.1kHz',
        channels: 'stereo',
        format: 'MP3',
        processingTimeMs: Date.now() - startTime
      },
      timings: {
        introDuration: formatDuration(INTRO_DURATION),
        contentDuration: formatDuration(metadata.seconds - INTRO_DURATION - OUTRO_DURATION),
        outroDuration: formatDuration(OUTRO_DURATION)
      }
    };

  } catch (error) {
    logger.error('Podcast creation failed', {
      sessionId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  } finally {
    await cleanTempFiles(tempDir, sessionId);
  }
}

// Helper functions
async function downloadAudio(url, destination) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 30000
  });

  const writer = fs.createWriteStream(destination);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(destination));
    writer.on('error', reject);
  });
}

async function validateAudioFiles(introPath, outroPath) {
  const [introDuration, outroDuration] = await Promise.all([
    getAudioDuration(introPath),
    getAudioDuration(outroPath)
  ]);

  if (introDuration < INTRO_DURATION) {
    throw new Error(`Intro must be at least ${INTRO_DURATION}s (got ${introDuration}s)`);
  }

  if (outroDuration < OUTRO_DURATION) {
    throw new Error(`Outro must be at least ${OUTRO_DURATION}s (got ${outroDuration}s)`);
  }
}

async function processAudioWithPrecision(introPath, contentPath, outroPath, outputPath) {
  const cmd = [
    'ffmpeg -y',
    `-i "${introPath}"`,
    `-i "${contentPath}"`,
    `-i "${outroPath}"`,
    '-filter_complex',
    `"[0]atrim=0:${INTRO_DURATION},` +
    `afade=t=in:st=0:d=${FADE_IN_DURATION},` +
    `afade=t=out:st=${INTRO_DURATION-FADE_IN_DURATION}:d=${FADE_IN_DURATION}[a0];` +
    `[1]afade=t=in:st=0:d=1,` +
    `afade=t=out:st=${CONTENT_FADE_OUT_START}:d=${CONTENT_FADE_OUT_DURATION}[a1];` +
    `[2]atrim=0:${OUTRO_DURATION},` +
    `afade=t=in:st=0:d=${FADE_IN_DURATION}[a2];` +
    `[a0][a1][a2]concat=n=3:v=0:a=1"`,
    '-c:a libmp3lame -q:a 1',
    '-b:a 192k',
    '-ar 44100',
    '-ac 2',
    `"${outputPath}"`
  ].join(' ');

  await execPromise(cmd);
}

async function getAudioMetadata(filePath) {
  const duration = await getAudioDuration(filePath);
  const stats = await fs.stat(filePath);
  
  return {
    duration: formatDuration(duration),
    seconds: duration,
    size: stats.size
  };
}

async function getAudioDuration(filePath) {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
  return parseFloat(await execPromise(cmd).stdout.trim());
}

function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return [hrs, mins, secs]
    .map(v => v.toString().padStart(2, '0'))
    .join(':');
}

async function uploadToPodcastBucket(filePath, key) {
  const fileData = await fs.readFile(filePath);
  
  await r2PodcastClient.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_PODCAST,
    Key: key,
    Body: fileData,
    ContentType: 'audio/mpeg',
    ACL: 'public-read',
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: {
      'x-amz-meta-processed': 'true',
      'x-amz-meta-service': 'tts-chunker'
    }
  }));

  return `${process.env.R2_PUBLIC_BASE_URL_PODCAST.replace(/\/+$/, '')}/${key}`;
}

async function cleanTempFiles(tempDir, sessionId) {
  const patterns = [
    `${sessionId}_merged.mp3`,
    `${sessionId}_intro.mp3`,
    `${sessionId}_outro.mp3`,
    `${sessionId}_final.mp3`
  ];

  await Promise.allSettled(
    patterns.map(pattern => 
      fs.unlink(path.join(tempDir, pattern)).catch(() => {})
    )
  );
}
