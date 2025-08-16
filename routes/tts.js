import express from "express";
import { getURLsBySessionId } from "../utils/textchunksR2.js";
import { processTTSChunks } from "../utils/processorTTS.js";   // ✅ correct file
import { mergeChunks } from "../utils/mergeTTSChunks.js";
import logger from "../utils/logger.js";

const router = express.Router();

/**
 * POST /api/tts
 * Input: { sessionId }
 */
router.post("/", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    logger.info("Starting TTS process", { sessionId });

    // 1. Get text chunk URLs from R2
    const textChunkUrls = await getURLsBySessionId(sessionId);
    if (!textChunkUrls || textChunkUrls.length === 0) {
      return res.status(404).json({ error: "No text chunks found for session" });
    }

    logger.info("Retrieved text chunk URLs", {
      sessionId,
      count: textChunkUrls.length,
    });

    // 2. Generate TTS chunks & upload to R2
    const audioChunkUrls = await processTTSChunks(sessionId, textChunkUrls);
    logger.info("Generated and uploaded audio chunks", {
      sessionId,
      count: audioChunkUrls.length,
    });

    // 3. Merge audio chunks with ffmpeg & upload merged file to R2
    const mergedUrl = await mergeChunks(sessionId, audioChunkUrls);
    logger.info("Merged audio chunks into final file", {
      sessionId,
      mergedUrl,
    });

    res.json({ success: true, mergedUrl });
  } catch (error) {
    logger.error("TTS pipeline failed", {
      sessionId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: "TTS pipeline failed", details: error.message });
  }
});

export default router;
