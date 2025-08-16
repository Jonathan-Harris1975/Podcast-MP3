// utils/googleTTS.js
import fs from "fs";
import textToSpeech from "@google-cloud/text-to-speech";

// Google Cloud client
const client = new textToSpeech.TextToSpeechClient();

/**
 * Synthesizes speech from text and saves it as an MP3 file.
 * @param {string} text - The text to convert to speech.
 * @param {string} outputPath - The path where the MP3 should be saved.
 */
export async function synthesizeAndSave(text, outputPath) {
  const request = {
    input: { text },
    voice: { languageCode: "en-GB", ssmlGender: "MALE" },
    audioConfig: { audioEncoding: "MP3" },
  };

  const [response] = await client.synthesizeSpeech(request);

  fs.writeFileSync(outputPath, response.audioContent, "binary");
  console.log(`✅ Audio content written to file: ${outputPath}`);
}
