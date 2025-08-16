import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import logger from './logger.js';
import pLimit from 'p-limit';

// Initialize client with fallbacks for different env var naming conventions
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY
  },
  // CRITICAL: Add client-level timeout configurations
  requestHandler: {
    requestTimeout: 120000, // 2 minutes per request
    connectionTimeout: 30000, // 30 seconds to establish connection
  }
});

// CRITICAL: Limit concurrent uploads to prevent overwhelming R2/network
const uploadLimit = pLimit(3); // Maximum 3 concurrent uploads

export async function uploadToR2(key, body, contentType = 'audio/mpeg', maxRetries = 3) {
  return uploadLimit(async () => {
    const bucket = process.env.R2_BUCKET_CHUNKS;
    const publicBase = process.env.R2_PUBLIC_BASE_URL_CHUNKS;
    const startTime = Date.now();

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

    // Validate body size
    const bodySize = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
    logger.info('R2 Upload Starting', {
      key,
      size: bodySize,
      sizeHuman: `${(bodySize / 1024 / 1024).toFixed(2)}MB`,
      contentType,
      bucket
    });

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`R2 Upload Attempt ${attempt}/${maxRetries}`, { key });

        // CRITICAL: Create upload command
        const uploadCommand = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Remove ACL as R2 doesn't support it the same way as S3
          CacheControl: 'public, max-age=31536000', // 1 year cache
          Metadata: {
            'upload-timestamp': new Date().toISOString(),
            'attempt': attempt.toString()
          }
        });

        // CRITICAL: Race against timeout
        const uploadPromise = r2Client.send(uploadCommand);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`R2 upload timeout after 90 seconds for key: ${key}`));
          }, 90000); // 90 seconds timeout
        });

        // Wait for upload or timeout
        await Promise.race([uploadPromise, timeoutPromise]);

        // Calculate and log success metrics
        const uploadTime = Date.now() - startTime;
        const cleanBase = publicBase.replace(/\/+$/, '');
        const cleanKey = key.replace(/^\/+/, '');
        const publicUrl = `${cleanBase}/${cleanKey}`;

        logger.info('R2 Upload Success', {
          key,
          url: publicUrl,
          size: bodySize,
          uploadTimeMs: uploadTime,
          attempt,
          throughputMbps: ((bodySize / 1024 / 1024) / (uploadTime / 1000)).toFixed(2)
        });

        return publicUrl;

      } catch (error) {
        const uploadTime = Date.now() - startTime;
        
        logger.error(`R2 Upload Attempt ${attempt} Failed`, {
          key,
          error: error.message,
          attempt,
          maxRetries,
          uploadTimeMs: uploadTime,
          errorType: error.name,
          stack: error.stack
        });

        // If this was the last attempt, throw the error
        if (attempt === maxRetries) {
          const finalError = new Error(`R2 upload failed after ${maxRetries} attempts: ${error.message}`);
          finalError.originalError = error;
          finalError.key = key;
          finalError.attempts = maxRetries;
          throw finalError;
        }

        // Exponential backoff before retry
        const backoffTime = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
        logger.info(`R2 Upload Retry Backoff`, {
          key,
          attempt,
          backoffMs: backoffTime
        });

        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  });
}

// CRITICAL: Batch upload function for multiple files
export async function uploadMultipleToR2(uploads) {
  const startTime = Date.now();
  logger.info('R2 Batch Upload Starting', {
    count: uploads.length,
    totalSizeBytes: uploads.reduce((sum, upload) => {
      const size = Buffer.isBuffer(upload.body) ? upload.body.length : Buffer.byteLength(upload.body);
      return sum + size;
    }, 0)
  });

  try {
    // Process all uploads concurrently with the limit
    const results = await Promise.all(
      uploads.map(async (upload, index) => {
        try {
          const url = await uploadToR2(
            upload.key, 
            upload.body, 
            upload.contentType || 'audio/mpeg'
          );
          
          return {
            index,
            key: upload.key,
            url,
            success: true,
            size: Buffer.isBuffer(upload.body) ? upload.body.length : Buffer.byteLength(upload.body)
          };
        } catch (error) {
          logger.error('Individual upload failed in batch', {
            index,
            key: upload.key,
            error: error.message
          });
          
          return {
            index,
            key: upload.key,
            success: false,
            error: error.message,
            size: Buffer.isBuffer(upload.body) ? upload.body.length : Buffer.byteLength(upload.body)
          };
        }
      })
    );

    const totalTime = Date.now() - startTime;
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const totalBytes = results.reduce((sum, r) => sum + r.size, 0);

    logger.info('R2 Batch Upload Complete', {
      total: uploads.length,
      successful: successful.length,
      failed: failed.length,
      totalTimeMs: totalTime,
      totalBytes,
      throughputMbps: ((totalBytes / 1024 / 1024) / (totalTime / 1000)).toFixed(2)
    });

    if (failed.length > 0) {
      logger.error('R2 Batch Upload Partial Failure', {
        failedKeys: failed.map(f => f.key),
        failedErrors: failed.map(f => f.error)
      });
    }

    return {
      successful,
      failed,
      totalTime,
      totalBytes
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error('R2 Batch Upload Failed', {
      error: error.message,
      totalTimeMs: totalTime,
      count: uploads.length
    });
    throw error;
  }
}

// Health check function for R2 connectivity
export async function testR2Connection() {
  const bucket = process.env.R2_BUCKET_CHUNKS;
  
  if (!bucket) {
    throw new Error('R2_BUCKET_CHUNKS not configured');
  }

  try {
    // Test with a small dummy upload
    const testKey = `health-check-${Date.now()}.txt`;
    const testBody = `Health check at ${new Date().toISOString()}`;
    
    const url = await uploadToR2(testKey, testBody, 'text/plain');
    
    logger.info('R2 Health Check Success', { testKey, url });
    
    return {
      status: 'healthy',
      bucket,
      testKey,
      url,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('R2 Health Check Failed', { error: error.message });
    throw error;
  }
            }
