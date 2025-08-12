import { generateTTS } from './googleTTS.js';
import { r2merged } from './r2merged.js';
import axios from 'axios';
import logger from './logger.js';
import { chunkTextToSSML } from './ssmlTools.js';

const useSSML = process.env.SSML_ENABLED === 'true';

export async function processURLsToMergedTTS(urls, sessionId) {
  const results = [];
  const urlArray = Array.isArray(urls) ? urls : [urls];

  for (const url of urlArray) {
    try {
      // 1. Fetch text content
      const { data: textContent } = await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'TTS-Chunker-Service' }
      });

      if (!textContent?.trim()) {
        results.push({ url, status: 'skipped', reason: 'empty content' });
        continue;
      }

      // 2. Prepare chunks
      const chunks = useSSML 
        ? chunkTextToSSML(textContent)
        : [textContent];

      // 3. Process chunks
      const chunkUrls = [];
      for (const [index, chunk] of chunks.entries()) {
        try {
          const audioBuffer = await generateTTS(chunk);
          const chunkKey = `${sessionId}/chunk_${index}.mp3`;
          const url = await r2merged(chunkKey, audioBuffer);
          chunkUrls.push(url);
        } catch (error) {
          logger.error(`Chunk ${index} failed:`, error);
        }
      }

      results.push({
        url,
        status: 'success',
        chunks: chunkUrls.filter(Boolean)
      });

    } catch (error) {
      logger.error(`URL processing failed: ${url}`, error);
      results.push({
        url,
        status: 'error',
        error: error.message
      });
    }
  }

  return {
    success: results.every(r => r.status === 'success'),
    sessionId,
    results
  };
}

// Backward compatibility
export const processTextToSpeech = processURLsToMergedTTS;
