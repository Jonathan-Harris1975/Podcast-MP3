import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import logger from './logger.js';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY
  }
});

export async function checkR2Config() {
  try {
    if (!process.env.R2_ENDPOINT || 
        !process.env.R2_ACCESS_KEY_ID || 
        !process.env.R2_SECRET_ACCESS_KEY) {
      throw new Error('Missing R2 configuration');
    }

    await r2Client.send(new ListBucketsCommand({}));
    return true;
  } catch (error) {
    logger.error('R2 configuration check failed', {
      error: error.message,
      config: {
        endpoint: !!process.env.R2_ENDPOINT,
        accessKey: !!process.env.R2_ACCESS_KEY_ID,
        secretKey: !!process.env.R2_SECRET_ACCESS_KEY
      }
    });
    return false;
  }
}

export async function uploadToR2Merged(key, body, contentType = 'audio/mpeg') {
  const bucket = process.env.R2_BUCKET_CHUNKS_MERGED || process.env.R2_BUCKET;
  const publicBase = process.env.R2_PUBLIC_BASE_URL_CHUNKS_MERGED || process.env.R2_PUBLIC_BASE_URL;

  if (!bucket || !publicBase) {
    throw new Error('R2 bucket configuration incomplete');
  }

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000'
      })
    );

    const cleanBase = publicBase.replace(/\/+$/, '');
    const cleanKey = key.replace(/^\/+/, '');
    return `${cleanBase}/${cleanKey}`;
  } catch (error) {
    logger.error('R2 upload failed', {
      error: error.message,
      bucket,
      key
    });
    throw error;
  }
}

export default {
  checkR2Config,
  uploadToR2Merged
};
