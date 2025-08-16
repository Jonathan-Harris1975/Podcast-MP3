import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import logger from './logger.js';

// Initialize client with fallbacks for different env var naming conventions
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY, // Supports both naming conventions
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY // Supports both naming conventions
  }
});

export async function uploadToR2(key, body, contentType = 'audio/mpeg') {
  const bucket = process.env.R2_BUCKET_CHUNKS;
  const publicBase = process.env.R2_PUBLIC_BASE_URL_CHUNKS;

  // Enhanced validation
  if (!bucket || !publicBase) {
    const error = new Error('Missing R2 chunks bucket configuration');
    logger.error('R2 Configuration Error', {
      error: error.message,
      missingBucket: !bucket,
      missingBaseUrl: !publicBase
    });
    throw error;
  }

  try {
    // Upload with enhanced options
    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000' // 1 year cache
      })
    );

    // Clean URL formatting
    const cleanBase = publicBase.replace(/\/+$/, ''); // Remove all trailing slashes
    const cleanKey = key.replace(/^\/+/, ''); // Remove leading slashes
    return `${cleanBase}/${cleanKey}`;

  } catch (error) {
    logger.error('R2 Upload Failed', {
      error: error.message,
      bucket,
      key,
      stack: error.stack
    });
    throw new Error(`Failed to upload to R2: ${error.message}`);
  }
}
