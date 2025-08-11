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

    // 3. Upload to podcast bucket
    const podcastKey = `${sessionId}.mp3`;
    const podcastUrl = await uploadToPodcastBucket(outputFile, podcastKey);

    return podcastUrl;
  } finally {
    // Cleanup temporary files
    await cleanTempFiles(tempDir, sessionId);
  }
}

async function downloadAudio(url, destination) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(destination);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(destination));
    writer.on('error', reject);
  });
}

async function processWithFading(introPath, contentPath, outroPath, outputPath) {
  const cmd = [
    'ffmpeg -y',
    `-i "${introPath}"`,  // Intro file
    `-i "${contentPath}"`,  // Main content
    `-i "${outroPath}"`,  // Outro file
    // Audio filters for professional transitions
    '-filter_complex',
    `"[0]afade=t=in:st=0:d=2,afade=t=out:st=8:d=2[a0];` +  // Intro: 2s fade in, 2s fade out at 8s
    ` [1]afade=t=in:st=0:d=1,afade=t=out:st=60:d=3[a1];` +  // Content: 1s fade in, 3s fade out
    ` [2]afade=t=in:st=0:d=2[a2];` +  // Outro: 2s fade in
    ` [a0][a1][a2]concat=n=3:v=0:a=1"`,  // Concatenate all parts
    '-c:a libmp3lame -q:a 1',  // High quality MP3 encoding
    `"${outputPath}"`
  ].join(' ');

  await execPromise(cmd);
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
  const files = [
    `${sessionId}_merged.mp3`,
    `${sessionId}_intro.mp3`,
    `${sessionId}_outro.mp3`,
    `${sessionId}_final.mp3`
  ];

  await Promise.allSettled(
    files.map(file => 
      fs.unlink(path.join(tempDir, file)).catch(() => {})
    )
  );
}
