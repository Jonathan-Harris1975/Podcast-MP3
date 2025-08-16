import express from "express";
import textToSpeech from "@google-cloud/text-to-speech";
import fetch from "node-fetch";
import { Buffer } from "buffer";

const router = express.Router();

// 🔑 Load credentials
if (!process.env.GOOGLE_KEY) {
  throw new Error("❌ GOOGLE_KEY environment variable is missing");
}

let credentials;
try {
  credentials = JSON.parse(process.env.GOOGLE_KEY);
} catch (err) {
  throw new Error("❌ Failed to parse GOOGLE_KEY JSON: " + err.message);
}

const ttsClient = new textToSpeech.TextToSpeechClient({
  projectId: credentials.project_id,
  credentials: {
    client_email: credentials.client_email,
    private_key: credentials.private_key,
  },
});

// 🎙️ POST /api/tts
// Payload: { "sessionId": "TT-2025-08-15" }
router.post("/", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    let chunkIndex = 1;
    const audioBuffers = [];

    while (true) {
      const chunkFile = `${sessionId}/chunk-${chunkIndex}.txt`;
      const textFileUrl = `https://pub-7a098297d4ef4011a01077c72929753c.r2.dev/${chunkFile}`;

      const response = await fetch(textFileUrl);
      if (!response.ok) {
        // Stop when we hit missing chunk
        if (chunkIndex === 1) {
          throw new Error(`No chunks found for sessionId: ${sessionId}`);
        }
        break;
      }

      const text = await response.text();
      if (text && text.trim().length > 0) {
        const request = {
          input: { text },
          voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
          audioConfig: { audioEncoding: "MP3" },
        };

        const [ttsResponse] = await ttsClient.synthesizeSpeech(request);
        audioBuffers.push(Buffer.from(ttsResponse.audioContent, "base64"));
      }

      chunkIndex++;
    }

    if (audioBuffers.length === 0) {
      return res.status(400).json({ error: "No valid chunks found" });
    }

    // Concatenate all MP3 buffers
    const finalAudio = Buffer.concat(audioBuffers);

    res.set("Content-Type", "audio/mpeg");
    res.send(finalAudio);
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: "Failed to synthesize speech" });
  }
});

export default router;
