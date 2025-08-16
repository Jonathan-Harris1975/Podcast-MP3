// mergeTTSChunks.js
import { spawn } from "child_process";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { uploadMergedToR2 } from "./utils/r2merged.js";
import logger from "./utils/logger.js";

/**
 * Merge chunk MP3 files into one MP3 and upload to R2 (merged bucket).
 *
 * @param {string[]} chunkFiles - Local file paths of chunk mp3s in correct order
 * @param {string} sessionId - Session identifier
 * @returns {Promise<string>} - Public URL of merged file in R2
 */
export default async function mergeTTSChunks(chunkFiles, sessionId) {
  if (!chunkFiles || chunkFiles.length === 0) {
    throw new Error("No chunk files provided to merge");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `merge-${sessionId}-`));
  const listFile = path.join(tmpDir, "inputs.txt");

  // ffmpeg concat requires a list file
  const content = chunkFiles.map(f => `file '${f}'`).join("\n");
  await fs.writeFile(listFile, content);

  const mergedPath = path.join(tmpDir, "merged.mp3");

  await new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      mergedPath,
    ]);

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });

  const mergedBuf = await fs.readFile(mergedPath);
  const key = `${sessionId}/merged.mp3`;
  const mergedUrl = await uploadMergedToR2(key, mergedBuf, "audio/mpeg");

  // cleanup
  try {
    await fs.unlink(listFile).catch(() => {});
    await fs.unlink(mergedPath).catch(() => {});
    await fs.rmdir(tmpDir).catch(() => {});
  } catch {}

  logger.info("Merged chunks uploaded", { sessionId, mergedUrl });
  return mergedUrl;
}
