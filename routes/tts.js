import express from "express";
import { v4 as uuidv4 } from "uuid";

import { processTTSChunk } from "../utils/processorTTS.js";
import { mergeChunksWithFFmpeg } from "../utils/mergeTTSChunks.js";
import { getURLsBySessionId } from "../utils/textchunksR2.js";

import logger from "../utils/logger.js";

const router = express.Router();

/**
 * POST /tts
 * Body: { text: string }
 */
router.post("/", async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing or invalid text input" });
  }

  const sessionId = uuidv4();
  logger.info("TTS request received", { sessionId, textLength: text.length });

  try {
    // Split text into chunks (e.g., sentences, 500 chars max)
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    let chunkIndex = 0;

    for (const sentence of sentences) {
      // TODO: Replace with real TTS API call (currently mocked)
      const fakeAudioBuffer = Buffer.from(`FAKEAUDIO_${sentence}`, "utf8");

      await processTTSChunk(sessionId, chunkIndex, fakeAudioBuffer);
      chunkIndex++;
    }

    // Merge all uploaded chunks into one file
    const mergedUrl = await mergeChunksWithFFmpeg(
      sessionId,
      Array.from({ length: chunkIndex }, (_, i) => `${sessionId}/chunk_${i}.mp3`)
    );

    logger.info("TTS completed successfully", { sessionId, mergedUrl });
    res.json({ sessionId, mergedUrl });

  } catch (err) {
    logger.error("TTS processing failed", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Failed to process TTS" });
  }
});

/**
 * GET /tts/:sessionId
 * Returns list of chunk URLs already in R2
 */
router.get("/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  try {
    const urls = await getURLsBySessionId(sessionId);
    res.json({ sessionId, urls });
  } catch (err) {
    logger.error("Failed to fetch chunk URLs", { sessionId, error: err.message });
    res.status(500).json({ error: "Failed to fetch chunk URLs" });
  }
});

export default router;
