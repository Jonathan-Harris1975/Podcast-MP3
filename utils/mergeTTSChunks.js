import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import r2merged from "./r2merged.js";   // ✅ fixed (no extra utils)
import logger from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function mergeChunksWithFFmpeg(sessionId, chunkFiles) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(__dirname, `${sessionId}_merged.mp3`);

    const ffmpegArgs = [
      "-y",
      "-i",
      `concat:${chunkFiles.join("|")}`,
      "-c",
      "copy",
      outputFile,
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.stderr.on("data", (data) => {
      logger.info(`ffmpeg: ${data}`);
    });

    ffmpeg.on("close", async (code) => {
      if (code === 0) {
        const fileBuffer = fs.readFileSync(outputFile);

        try {
          const url = await r2merged(`${sessionId}/merged.mp3`, fileBuffer);
          fs.unlinkSync(outputFile);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
              }
