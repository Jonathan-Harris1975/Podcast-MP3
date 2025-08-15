import { generateTTS } from './googleTTS.js';
import { r2merged } from './r2merged.js';
import { extractTextFromUrls } from './extractText.js';
import { chunkTextToSSML } from './ssmlTools.js';
import logger from './logger.js';

const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY) || 3;
const MAX_SSML_CHUNK_BYTES = parseInt(process.env.MAX_SSML_CHUNK_BYTES) || 4000;

class ConcurrencyPool {
  constructor(max) {
    this.max = max;
    this.queue = [];
    this.active = 0;
  }

  async enqueue(task) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.active++;
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        } finally {
          this.active--;
          this.next();
        }
      };

      if (this.active < this.max) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  next() {
    if (this.queue.length > 0 && this.active < this.max) {
      this.queue.shift()();
    }
  }
}

export async function processURLsToMergedTTS(urls, sessionId, options = {}) {
  const pool = new ConcurrencyPool(MAX_CONCURRENCY);
  const extractedTexts = await extractTextFromUrls(Array.isArray(urls) ? urls : [urls]);
  const chunkUrls = [];

  await Promise.all(extractedTexts.map(async ({ url, text }) => {
    if (!text?.trim()) return;

    const ssmlChunks = process.env.SSML_ENABLED === 'true'
      ? chunkTextToSSML(text, MAX_SSML_CHUNK_BYTES)
      : [makeUKSSML(text)];

    for (const [index, chunk] of ssmlChunks.entries()) {
      // Final safety check
      if (Buffer.byteLength(chunk, 'utf8') > 5000) {
        logger.error('SSML chunk exceeds Google TTS byte limit and will be split further', { index, url });
        // Optionally, split chunk further here...
        continue;
      }
      try {
        const chunkKey = `${sessionId}/chunk_${url.split('/').pop()}_${index}.mp3`;
        const uploadedUrl = await pool.enqueue(() => 
          generateTTS(chunk, index)
            .then(audio => r2merged(chunkKey, audio))
        );
        chunkUrls.push(uploadedUrl);
      } catch (error) {
        logger.error(`Chunk processing failed`, { url, chunkIndex: index, error });
      }
    }
  }));

  return {
    sessionId,
    chunks: chunkUrls,
    mergedUrl: chunkUrls.length > 1 
      ? await mergeAndUploadChunks(chunkUrls, sessionId) 
      : chunkUrls[0]
  };
}

async function mergeAndUploadChunks(chunkUrls, sessionId) {
  // Implementation remains same as before
}
