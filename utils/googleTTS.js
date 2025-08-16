import express from "express";
import textToSpeech from "@google-cloud/text-to-speech";

const router = express.Router();

// Load credentials from environment variable GOOGLE_CREDENTIALS
// (paste the whole JSON service account into Render’s env var)
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const ttsClient = new textToSpeech.TextToSpeechClient({
  credentials: {
    client_email: credentials.client_email,
    private_key: credentials.private_key,
  },
});

router.post("/", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text is required" });
    }

    const request = {
      input: { text },
      // pick your voice and language here
      voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
      audioConfig: { audioEncoding: "MP3" },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);

    res.set("Content-Type", "audio/mpeg");
    res.send(response.audioContent);
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: "Failed to synthesize speech" });
  }
});

export default router;
