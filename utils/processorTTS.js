// utils/processorTTS.js
import { r2upload } from "./r2upload.js";
import logger from "./logger.js";

/**
 * Splits text into chunks, generates TTS audio for each,
 * and uploads them to R2.
 *
 * @param {string} sessionId - Unique session identifier
 * @param {string[]} textChunks - Array of text strings
 * @param {Function} ttsFn - Function that takes text and returns audio buffer
 * @returns {Promise<string[]>} - List of public URLs to the uploaded audio chunks
 */
export async function processTTSChunks(sessionId, textChunks, ttsFn) {
  if (!textChunks || textChunks.length === 0) {
    throw new Error("No text chunks provided");
  }

  const uploadedUrls = [];

  for (let i = 0; i < textChunks.length; i++) {
    const text = textChunks[i];

    try {
      // Generate audio buffer
      const audioBuffer = await ttsFn(text);
      if (!audioBuffer) {
        throw new Error(`TTS returned empty audio for chunk ${i}`);
      }

      // Upload to R2 bucket
      const key = `${sessionId}/chunk-${i}.mp3`;
      const publicUrl = await r2upload(key, audioBuffer, "audio/mpeg");

      uploadedUrls.push(publicUrl);

      logger.info("Uploaded chunk", {
        sessionId,
        index: i,
        url: publicUrl,
        textLength: text.length
      });

    } catch (err) {
      logger.error("Failed processing chunk", {
        sessionId,
        index: i,
        text,
        error: err.message
      });
      throw err;
    }
  }

  return uploadedUrls;
}
