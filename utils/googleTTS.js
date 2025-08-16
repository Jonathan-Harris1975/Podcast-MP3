// utils/googleTTS.js
import fs from "fs";
import textToSpeech from "@google-cloud/text-to-speech";

const { GCP_PROJECT_ID, GCP_LOCATION, GOOGLE_APPLICATION_CREDENTIALS } = process.env;

// Validate env vars
if (!GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error(
    "Missing GOOGLE_APPLICATION_CREDENTIALS. Set this to the full path of your service account JSON file (on Render: /etc/secrets/<file>.json)."
  );
}
if (!GCP_PROJECT_ID) {
  console.warn("⚠️ GCP_PROJECT_ID not set. Default project from credentials will be used.");
}
if (!GCP_LOCATION) {
  console.warn("⚠️ GCP_LOCATION not set. Default location (global) will be used.");
}

// Create Google Cloud TTS client with explicit project/location
const client = new textToSpeech.TextToSpeechClient({
  projectId: GCP_PROJECT_ID,
  keyFilename: GOOGLE_APPLICATION_CREDENTIALS,
});

/**
 * Synthesizes speech from text and saves it as an MP3 file.
 * @param {string} text - The text to convert to speech.
 * @param {string} outputPath - The path where the MP3 should be saved.
 */
export async function synthesizeAndSave(text, outputPath) {
  const request = {
    input: { text },
    voice: {
      languageCode: "en-GB",
      ssmlGender: "MALE",
    },
    audioConfig: { audioEncoding: "MP3" },
  };

  const [response] = await client.synthesizeSpeech(request);
  fs.writeFileSync(outputPath, response.audioContent, "binary");

  console.log(`✅ Audio content written to file: ${outputPath}`);
}
