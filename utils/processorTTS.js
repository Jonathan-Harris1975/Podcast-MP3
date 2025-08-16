import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import r2upload from "./r2upload.js";   // ✅ fixed
import logger from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function processTTSChunk(sessionId, index, audioBuffer) {
  try {
    const filePath = path.join(__dirname, `${sessionId}_chunk_${index}.mp3`);
    fs.writeFileSync(filePath, audioBuffer);

    const url = await r2upload(`${sessionId}/chunk_${index}.mp3`, audioBuffer);
    fs.unlinkSync(filePath);

    logger.info("TTS chunk processed and uploaded", { sessionId, index, url });
    return url;
  } catch (error) {
    logger.error("Failed to process TTS chunk", { error, sessionId, index });
    throw error;
  }
}
