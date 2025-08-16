// utils/r2.js
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// ----------------------
// Configure S3 (Cloudflare R2 is S3-compatible)
// ----------------------
const s3 = new S3Client({
  region: "auto", // required by R2 but ignored internally
  endpoint: process.env.R2_ENDPOINT, // e.g. https://<accountid>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({
    requestTimeout: 120000, // 2 min request budget
    connectionTimeout: 30000, // 30s connect budget
  }),
});

const R2_BUCKET_PODCAST = process.env.R2_BUCKET_PODCAST; // final audio
const R2_BUCKET_CHUNKS = process.env.R2_BUCKET_CHUNKS;   // text chunks (if needed)

// ----------------------
// Upload helpers
// ----------------------
/**
 * Uploads a buffer or stream to the podcast bucket
 * @param {string} key - object key (e.g. "session123/final.mp3")
 * @param {Buffer|ReadableStream} body
 * @param {string} contentType
 * @returns {Promise<string>} key
 */
export async function uploadToR2(key, body, contentType = "application/octet-stream") {
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_PODCAST,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

// ----------------------
// Download helpers
// ----------------------
/**
 * Returns a readable stream for a podcast audio file
 * @param {string} key - object key in the podcast bucket
 */
export async function getPodcastAudio(key) {
  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET_PODCAST,
      Key: key,
    })
  );
  return obj.Body; // Node.js readable stream
}

/**
 * Generic fetch from any bucket
 * @param {string} bucket
 * @param {string} key
 */
export async function getFromR2(bucket, key) {
  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
  return obj.Body;
}

// ----------------------
// Exports
// ----------------------
export {
  s3,
  R2_BUCKET_PODCAST,
  R2_BUCKET_CHUNKS,
};
