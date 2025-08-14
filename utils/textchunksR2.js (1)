import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import logger from './logger.js';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY
  },
  maxAttempts: 3 // Added maxAttempts for robustness, similar to r2merged.js
});

export async function getURLsBySessionId(sessionId) {
  const bucket = process.env.R2_BUCKET_CHUNKS;
  const publicBase = process.env.R2_PUBLIC_BASE_URL_1;

  if (!bucket) {
    logger.error('Missing R2 chunks bucket name', {
      availableVars: Object.keys(process.env).filter(k => k.includes('BUCKET'))
    });
    throw new Error('Configuration error: No R2_BUCKET_CHUNKS specified');
  }

  if (!publicBase) {
    logger.error('Missing R2 public URL for chunks', {
      availableVars: Object.keys(process.env).filter(k => k.includes('PUBLIC'))
    });
    throw new Error('Configuration error: No R2_PUBLIC_BASE_URL_1 specified');
  }

  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${sessionId}/`,
      MaxKeys: 1000 // Adjust as needed
    });

    const response = await r2Client.send(listCommand);
    
    if (!response.Contents || response.Contents.length === 0) {
      logger.info('No objects found for sessionId', { sessionId });
      return [];
    }

    const cleanBase = publicBase.replace(/\/+$/, ''); // Remove all trailing slashes
    const urls = response.Contents.map(obj => {
      const cleanKey = obj.Key.replace(/^\/+/, ''); // Remove leading slashes
      return `${cleanBase}/${cleanKey}`;
    });

    logger.info('Retrieved URLs for sessionId', {
      sessionId,
      count: urls.length,
      urls: urls.slice(0, 5) // Log first 5 URLs for debugging
    });

    return urls;

  } catch (error) {
    logger.error('R2 List Objects Failed', {
      error: error.message,
      bucket,
      sessionId,
      stack: error.stack
    });
    throw new Error(`Failed to retrieve URLs from R2: ${error.message}`);
  }
}

