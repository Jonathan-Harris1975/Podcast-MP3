import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import logger from "./logger.js";

const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY,
  },
  maxAttempts: 3,
});

export async function getURLsBySessionId(sessionId) {
  // ... unchanged
}
