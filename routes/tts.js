import express from "express";
import textToSpeech from "@google-cloud/text-to-speech";
import fetch from "node-fetch";

const router = express.Router();

// 🔑 Load credentials from Render env var
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
// Payload: { "sessionId": "abc123" }
router.post("/", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    // ⚡️ Construct R2 text file URL
    // (update this pattern to match your bucket path)
    const textFileUrl = `https://<your-r2-bucket-domain>/${sessionId}.txt`;

    // Fetch raw text from R2
    const response = await fetch(textFileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch text file: ${response.statusText}`);
    }

    const text = await response.text();
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text file was empty" });
    }

    // Google TTS request
    const request = {
      input: { text },
      voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
      audioConfig: { audioEncoding: "MP3" },
    };

    const [ttsResponse] = await ttsClient.synthesizeSpeech(request);

    res.set("Content-Type", "audio/mpeg");
    res.send(ttsResponse.audioContent);
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: "Failed to synthesize speech" });
  }
});

export default router;
