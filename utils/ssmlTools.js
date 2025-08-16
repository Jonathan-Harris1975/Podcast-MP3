// utils/ssmlTools.js
// Deterministic SSML utilities: chunking and safe markup

import { Buffer } from "buffer";

function normalizeText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\.\s+/g, ". <break time=\"400ms\"/> ")
    .replace(/,\s+/g, ", <break time=\"200ms\"/> ");
}

export function convertToSSML(text) {
  const norm = normalizeText(text);
  return `<speak><prosody rate="1.15" pitch="-3.0st" volume="+1.5dB">${norm}</prosody></speak>`;
}

export function chunkByBytes(text, maxBytes = 3400) {
  const words = text.split(/\s+/);
  const chunks = [];
  let current = "";

  for (const word of words) {
    const trial = current.length ? current + " " + word : word;
    const ssmlTrial = convertToSSML(trial);
    if (Buffer.byteLength(ssmlTrial, "utf8") <= maxBytes) {
      current = trial;
    } else {
      if (current) chunks.push(convertToSSML(current));
      current = word;
    }
  }
  if (current) chunks.push(convertToSSML(current));
  return chunks;
}

export function buildDeterministicSSMLChunks(text) {
  return chunkByBytes(text, 3400);
}
