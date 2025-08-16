import express from "express";
import textToSpeech from "@google-cloud/text-to-speech";
import fetch from "node-fetch"; // make sure you have this installed

const router = express.Router();

// Load credentials from environment variable GOOGLE_CREDENTIALS
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const ttsClient = new textToSpeech.TextToSpeechClient({
  credentials: {
    client_email: credentials.client_email,
    private_key: credentials.private_key,
  },
});

router.post("/", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId || sessionId.trim().length === 0) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    // ✅ Construct the R2 bucket URL for the text file
    // (adjust this pattern to match how your repo stores them)
    const textFileUrl = `https://<your-r2-bucket-domain>/${sessionId}.txt`;

    // Fetch the raw text from R2
    const response = await fetch(textFileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch text file: ${response.statusText}`);
    }

    const text = await response.text();

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "No text found in file" });
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
