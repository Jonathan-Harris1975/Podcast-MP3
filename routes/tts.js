// routes/tts.js
import express from "express";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import pLimit from "p-limit";

import { uploadToR2 } from "../utils/r2.js";
import mergeTTSChunks from "../mergeTTSChunks.js";
import logger from "../utils/logger.js";
import { loadScriptForSession } from "../utils/sessionStore.js"; // new util

const router = express.Router();
const ttsClient = new TextToSpeechClient();
const limit = pLimit(3);

function splitIntoChunks(text, maxLen = 4500) {
  const parts = [];
  let current = "";
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    if ((current + " " + s).trim().length > maxLen) {
      if (current) parts.push(current.trim());
      if (s.length > maxLen) {
        for (let i = 0; i < s.length; i += maxLen) {
          parts.push(s.slice(i, i + maxLen));
        }
        current = "";
      } else {
        current = s;
      }
    } else {
      current = (current ? current + " " : "") + s;
    }
  }
  if (current) parts.push(current.trim());
  return parts;
}

router.post("/", async (req, res) => {
  const started = Date.now();
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId required" });
    }

    // 🔹 Load the script for this sessionId
    const scriptText = await loadScriptForSession(sessionId);
    if (!scriptText) {
      return res.status(404).json({ error: `No script found for session ${sessionId}` });
    }

    const pieces = splitIntoChunks(String(scriptText));
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `tts-${sessionId}-`));

    const synthOptions = {
      languageCode: "en-US",
      name: "en-US-Neural2-C",
      ssmlGender: "FEMALE",
      speakingRate: 1.0,
      pitch: 0.0,
    };

    const localFiles = await Promise.all(
      pieces.map((p, i) =>
        limit(async () => {
          const [resp] = await ttsClient.synthesizeSpeech({
            input: { text: p },
            voice: {
              languageCode: synthOptions.languageCode,
              name: synthOptions.name,
              ssmlGender: synthOptions.ssmlGender,
            },
            audioConfig: {
              audioEncoding: "MP3",
              speakingRate: synthOptions.speakingRate,
              pitch: synthOptions.pitch,
            },
          });

          const buf = Buffer.from(resp.audioContent, "base64");
          const filename = path.join(tmpDir, `${String(i).padStart(3, "0")}.mp3`);
          await fs.writeFile(filename, buf);

          const key = `${sessionId}/raw-${String(i).padStart(3, "0")}.mp3`;
          const url = await uploadToR2(key, buf, "audio/mpeg");

          return { index: i, bytes: buf.length, local: filename, url };
        })
      )
    );

    localFiles.sort((a,b)=>a.index-b.index);

    const mergedUrl = await mergeTTSChunks(localFiles.map(x=>x.local), sessionId);

    const payload = {
      sessionId,
      count: localFiles.length,
      chunks: localFiles.map(({ index, bytes, url }) => ({
        index,
        bytesApprox: bytes,
        url,
      })),
      merged: { url: mergedUrl },
      elapsedMs: Date.now() - started,
    };

    res.status(200).json(payload);

    try {
      await Promise.all(localFiles.map(f => fs.unlink(f.local).catch(()=>{})));
      await fs.rmdir(tmpDir).catch(()=>{});
    } catch {}
  } catch (err) {
    logger.error("TTS failed", { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

export default router;
