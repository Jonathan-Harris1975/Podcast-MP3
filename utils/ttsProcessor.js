// utils/ttsProcessor.js
// Orchestrates SSML generation + Google TTS

import fs from "fs";
import path from "path";
import { generateDynamicSSML } from "./chatgptSSMLGenerator.js";
import { synthesizeAndSave } from "./googleTTS.js";

export async function processTTS(inputText, outputFilePath) {
  console.log("Generating SSML chunks...");
  const ssmlChunks = await generateDynamicSSML(inputText);

  console.log(`Got ${ssmlChunks.length} SSML chunks.`);

  for (let i = 0; i < ssmlChunks.length; i++) {
    const chunkFile = outputFilePath.replace(/\.mp3$/, `_${i}.mp3`);
    console.log(`Synthesizing chunk ${i + 1}/${ssmlChunks.length}...`);
    await synthesizeAndSave(ssmlChunks[i], chunkFile);
  }

  // Concatenate all chunk MP3s into final output
  const finalStream = fs.createWriteStream(outputFilePath);
  for (let i = 0; i < ssmlChunks.length; i++) {
    const chunkFile = outputFilePath.replace(/\.mp3$/, `_${i}.mp3`);
    const data = fs.readFileSync(chunkFile);
    finalStream.write(data);
    fs.unlinkSync(chunkFile); // cleanup
  }
  finalStream.end();
  console.log("Final MP3 generated:", outputFilePath);
}
