import { generateTTS } from './googleTTS.js';
import { r2merged } from './r2merged.js';
import { extractTextFromUrls } from './extractText.js';
import { chunkTextToSSML, convertToSSML } from './ssmlTools.js';
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

    let ssmlChunks;
    if (process.env.SSML_ENABLED === 'true') {
      try {
        ssmlChunks = await chunkTextToSSML(text, MAX_SSML_CHUNK_BYTES);
        logger.info('Generated SSML chunks', { 
          url, 
          chunkCount: ssmlChunks.length,
          firstChunkSample: ssmlChunks[0]?.substring(0, 150)
        });
      } catch (error) {
        logger.warn('SSML generation failed, falling back to basic conversion', { url, error: error.message });
        ssmlChunks = [convertToSSML(text)];
      }
    } else {
      // Even if SSML is disabled, we still need basic SSML wrapping for Google TTS
      logger.info('SSML disabled, using basic conversion', { url });
      ssmlChunks = [convertToSSML(text)];
    }

    // Validate all chunks have proper SSML format
    ssmlChunks = ssmlChunks.map((chunk, idx) => {
      if (!chunk.includes('<speak>')) {
        logger.warn('Chunk missing SSML wrapper, fixing', { url, chunkIndex: idx });
        return convertToSSML(chunk);
      }
      return chunk;
    });

    for (const [index, chunk] of ssmlChunks.entries()) {
      // Final safety check
      if (Buffer.byteLength(chunk, 'utf8') > 5000) {
        logger.error('SSML chunk exceeds Google TTS byte limit and will be split further', { index, url });
        continue;
      }
      
      // Log what we're sending to TTS
      logger.info('Sending chunk to TTS', {
        url,
        chunkIndex: index,
        isSSML: chunk.includes('<speak>'),
        chunkSample: chunk.substring(0, 200)
      });
      
      try {
        const chunkKey = `${sessionId}/chunk_${url.split('/').pop()}_${index}.mp3`;
        const uploadedUrl = await pool.enqueue(() => 
          generateTTS(chunk, index)
            .then(audio => r2merged(chunkKey, audio))
        );
        chunkUrls.push(uploadedUrl);
      } catch (error) {
        logger.error(`Chunk processing failed`, { url, chunkIndex: index, error: error.message });
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
  try {
    logger.info('Starting merge process for chunks', { 
      sessionId, 
      chunkCount: chunkUrls.length 
    });

    // Download all audio chunks
    const audioBuffers = await Promise.all(
      chunkUrls.map(async (url, index) => {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Failed to download chunk ${index}: ${response.statusText}`);
          }
          return await response.arrayBuffer();
        } catch (error) {
          logger.error(`Error downloading chunk ${index}`, { url, error });
          throw error;
        }
      })
    );

    // Simple concatenation for MP3 files
    // Note: This is a basic approach. For production, consider using ffmpeg
    const totalLength = audioBuffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    const mergedBuffer = new Uint8Array(totalLength);
    
    let offset = 0;
    audioBuffers.forEach(buffer => {
      mergedBuffer.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    });

    // Upload merged file
    const mergedKey = `${sessionId}/merged_audio.mp3`;
    const mergedUrl = await r2merged(mergedKey, mergedBuffer.buffer);

    logger.info('Successfully merged and uploaded audio', { 
      sessionId, 
      mergedUrl,
      totalSize: totalLength 
    });

    return mergedUrl;
  } catch (error) {
    logger.error('Failed to merge audio chunks', { sessionId, error });
    throw error;
  }
          }
