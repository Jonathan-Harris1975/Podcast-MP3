import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { r2merged } from "./utils/r2merged.js";
import logger from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Merge audio chunks into a single MP3 file using ffmpeg
 * @param {string[]} chunkPaths - Local file paths of chunk mp3 files
 * @param {string} sessionId - Session identifier for storage in R2
 * @returns {Promise<string>} - Public URL of the merged MP3
 */
export async function mergeChunks(chunkPaths, sessionId) {
  if (!chunkPaths || chunkPaths.length === 0) {
    throw new Error("No chunk paths provided for merging");
  }

  logger.info("Merging TTS chunks with ffmpeg", { sessionId, count: chunkPaths.length });

  // Create a temporary inputs.txt file for ffmpeg concat
  const inputsFile = path.join(__dirname, `inputs-${sessionId}.txt`);
  const fileList = chunkPaths.map((p) => `file '${p}'`).join("\n");
  fs.writeFileSync(inputsFile, fileList);

  const mergedFile = path.join(__dirname, `merged-${sessionId}.mp3`);

  await new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", inputsFile,
      "-c", "copy",
      mergedFile,
    ]);

    ffmpeg.stderr.on("data", (data) => {
      logger.debug(`ffmpeg: ${data}`);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });

  const mergedBuffer = fs.readFileSync(mergedFile);

  // Upload merged file to R2
  const key = `${sessionId}/merged.mp3`;
  const mergedUrl = await r2merged(key, mergedBuffer, "audio/mpeg");

  // Cleanup local files
  try {
    fs.unlinkSync(inputsFile);
    fs.unlinkSync(mergedFile);
  } catch (err) {
    logger.warn("Failed to cleanup temp files", { error: err.message });
  }

  logger.info("Successfully merged TTS chunks", { sessionId, mergedUrl });
  return mergedUrl;
}
