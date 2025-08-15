import { convertToSSML } from './chatgptSSMLGenerator.js';
import { editAndFormat } from './audioEffects.js';

const DEFAULT_MAX_CHUNK_BYTES = 4000;

export function chunkTextToSSML(text, maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES) {
  const ssml = convertToSSML(text);
  const chunks = [];
  let currentChunk = '';
  let currentChunkBytes = 0;

  const sentences = ssml.match(/[^.!?\n]+[.!?\n]+/g) || [ssml];

  for (const sentence of sentences) {
    const sentenceBytes = Buffer.byteLength(sentence, 'utf8');

    if (currentChunkBytes + sentenceBytes <= maxChunkBytes) {
      currentChunk += sentence;
      currentChunkBytes += sentenceBytes;
    } else {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }
      currentChunk = sentence;
      currentChunkBytes = sentenceBytes;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  // Apply editAndFormat only to main chunks, not intro/outro
  const processedChunks = chunks.map(chunk => editAndFormat(chunk));

  return processedChunks;
}
