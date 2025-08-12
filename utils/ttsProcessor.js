// utils/ttsProcessor.js
import { generateTTS } from './googleTTS.js';
import { r2merged } from './r2merged.js';
import { extractTextFromUrls } from './extractText.js';
import { chunkTextToSSML, makeUKSSML } from './ssmlTools.js';
import { validateSSML } from './ssmlValidator.js';
import logger from './logger.js';
import { generateEnhancedSSML } from './chatgptSSMLGenerator.js'; // From previous example

// Constants
const MAX_CHUNK_LENGTH = parseInt(process.env.MAX_CHUNK_LENGTH) || 4500;
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY) || 3;
const USE_CHATGPT_SSML = process.env.USE_CHATGPT_SSML === 'true';
const USE_DIRECT_URL_PROCESSING = process.env.USE_DIRECT_URL_PROCESSING === 'true';

class Semaphore {
  constructor(maxConcurrency) {
    this.tasks = [];
    this.count = maxConcurrency;
  }

  acquire() {
    return new Promise(resolve => {
      if (this.count > 0) {
        this.count--;
        resolve();
      } else {
        this.tasks.push(resolve);
      }
    });
  }

  release() {
    this.count++;
    if (this.tasks.length > 0) {
      this.tasks.shift()();
    }
  }
}

const semaphore = new Semaphore(MAX_CONCURRENCY);

/**
 * Enhanced TTS Processor with URL handling, SSML optimization, and concurrency control
 */
export async function processURLsToMergedTTS(urls, sessionId, options = {}) {
  const startTime = Date.now();
  const urlArray = Array.isArray(urls) ? urls : [urls];
  const results = [];
  const chunkUrls = [];

  try {
    // 1. Extract and preprocess text content
    const extractedTexts = USE_DIRECT_URL_PROCESSING 
      ? await extractTextFromUrls(urlArray)
      : urlArray.map(url => ({ url, text: url, status: 'success' }));

    // 2. Process each text segment
    await Promise.all(extractedTexts.map(async ({ url, text, status }) => {
      if (status !== 'success' || !text?.trim()) {
        results.push({ url, status: 'skipped', reason: 'empty or failed content' });
        return;
      }

      try {
        // 3. Generate optimized SSML (with optional ChatGPT enhancement)
        const ssmlChunks = await generateOptimizedSSMLChunks(text, options);

        // 4. Process chunks with concurrency control
        const processedChunks = await processChunksWithConcurrency(
          ssmlChunks,
          sessionId,
          url
        );

        chunkUrls.push(...processedChunks.filter(Boolean));
        results.push({
          url,
          status: 'success',
          chunks: processedChunks.filter(Boolean),
          charCount: text.length,
          ssmlChunks: ssmlChunks.length
        });

      } catch (error) {
        logger.error(`URL processing failed: ${url}`, error);
        results.push({
          url,
          status: 'error',
          error: error.message,
          stack: error.stack
        });
      }
    });

    // 5. Generate merged audio if multiple chunks exist
    const mergedUrl = chunkUrls.length > 1
      ? await mergeAndUploadChunks(chunkUrls, sessionId)
      : chunkUrls[0] || null;

    return {
      success: results.every(r => r.status === 'success'),
      sessionId,
      results,
      chunks: chunkUrls,
      mergedUrl,
      processingTimeMs: Date.now() - startTime,
      metrics: {
        totalUrls: urlArray.length,
        successfulUrls: results.filter(r => r.status === 'success').length,
        totalChunks: chunkUrls.length,
        avgCharsPerChunk: Math.round(
          results.reduce((sum, r) => sum + (r.charCount || 0), 0) / 
          (chunkUrls.length || 1)
        )
      }
    };

  } catch (error) {
    logger.error('TTS processing failed', {
      sessionId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function generateOptimizedSSMLChunks(text, options) {
  try {
    // Use ChatGPT-enhanced SSML if enabled and available
    if (USE_CHATGPT_SSML && process.env.OPENAI_API_KEY) {
      try {
        const enhancedSSML = await generateEnhancedSSML(text, options);
        const validation = validateSSML(enhancedSSML);
        if (validation.isValid) {
          return [enhancedSSML]; // Return as single chunk (ChatGPT handles structure)
        }
      } catch (chatGPTError) {
        logger.warn('ChatGPT SSML generation failed, falling back', chatGPTError);
      }
    }

    // Fallback to our robust SSML generation
    return process.env.SSML_ENABLED === 'true'
      ? chunkTextToSSML(text, MAX_CHUNK_LENGTH)
      : [makeUKSSML(text)];
  } catch (error) {
    logger.error('SSML generation failed', error);
    throw new Error(`SSML processing error: ${error.message}`);
  }
}

async function processChunksWithConcurrency(chunks, sessionId, sourceUrl) {
  const chunkResults = [];
  
  await Promise.all(chunks.map(async (chunk, index) => {
    await semaphore.acquire();
    try {
      const audioBuffer = await generateTTS(chunk);
      const chunkKey = `${sessionId}/chunks/${sourceUrl.split('/').pop()}_${index}.mp3`;
      const uploadedUrl = await r2merged(chunkKey, audioBuffer);
      chunkResults[index] = uploadedUrl;
    } catch (error) {
      logger.error(`Chunk ${index} processing failed`, {
        sourceUrl,
        chunkIndex: index,
        error: error.message
      });
      chunkResults[index] = null;
    } finally {
      semaphore.release();
    }
  }));

  return chunkResults.filter(url => url !== null);
}

async function mergeAndUploadChunks(chunkUrls, sessionId) {
  try {
    // Download chunks locally
    const tempDir = '/tmp/audio-processing';
    const downloadedFiles = await Promise.all(
      chunkUrls.map(async (url, index) => {
        const filePath = path.join(tempDir, `${sessionId}_chunk_${index}.mp3`);
        await downloadFile(url, filePath);
        return filePath;
      })
    );

    // Merge with ffmpeg
    const mergedFile = path.join(tempDir, `${sessionId}_merged.mp3`);
    await mergeAudioFiles(downloadedFiles, mergedFile);

    // Upload merged file
    const mergedKey = `${sessionId}/merged.mp3`;
    const mergedData = await fs.readFile(mergedFile);
    const mergedUrl = await r2merged(mergedKey, mergedData);

    // Cleanup
    await Promise.allSettled([
      ...downloadedFiles.map(f => fs.unlink(f).catch(() => {})),
      fs.unlink(mergedFile).catch(() => {})
    ]);

    return mergedUrl;
  } catch (error) {
    logger.error('Chunk merging failed', {
      sessionId,
      error: error.message,
      stack: error.stack
    });
    throw new Error(`Failed to merge chunks: ${error.message}`);
  }
}

// Helper functions
async function downloadFile(url, destination) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 30000
  });

  const writer = fs.createWriteStream(destination);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function mergeAudioFiles(inputFiles, outputFile) {
  const fileList = path.join('/tmp', `filelist_${Date.now()}.txt`);
  await fs.writeFile(fileList, inputFiles.map(f => `file '${f}'`).join('\n'));

  try {
    await execPromise(
      `ffmpeg -y -f concat -safe 0 -i "${fileList}" -c copy "${outputFile}"`
    );
  } finally {
    await fs.unlink(fileList).catch(() => {});
  }
}

// Backward compatibility
export const processTextToSpeech = processURLsToMergedTTS;
