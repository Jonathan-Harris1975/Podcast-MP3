import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import logger from './logger.js';

const r2MergedClient = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY
  },
  maxAttempts: 3
});

export async function uploadToR2Merged(key, body, contentType = 'audio/mpeg') {
  // Use the new standardized variable names
  const bucket = process.env.R2_BUCKET_CHUNKS_MERGED;
  const publicBase = process.env.R2_PUBLIC_BASE_URL_CHUNKS_MERGED;

  if (!bucket) {
    logger.error('Missing R2 merged bucket name', {
      availableVars: Object.keys(process.env).filter(k => k.includes('BUCKET'))
    });
    throw new Error('Configuration error: No merged bucket specified');
  }

  if (!publicBase) {
    logger.error('Missing R2 merged public URL', {
      availableVars: Object.keys(process.env).filter(k => k.includes('PUBLIC'))
    });
    throw new Error('Configuration error: No public URL base specified');
  }

  try {
    const result = await r2MergedClient.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable'
      })
    );

    const publicUrl = `${publicBase.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
    
    logger.info('Successfully uploaded merged file', {
      bucket,
      key,
      url: publicUrl,
      size: body.length,
      etag: result.ETag
    });

    return publicUrl;
  } catch (error) {
    logger.error('R2 upload failed', {
      error: error.message,
      stack: error.stack,
      bucket,
      key,
      bodySize: body?.length
    });
    throw new Error(`Failed to upload merged file: ${error.message}`);
  }
}
