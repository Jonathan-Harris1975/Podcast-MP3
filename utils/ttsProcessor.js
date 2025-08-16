import { processTextFromURLs } from './textProcessor.js';
import { mergeAudioFiles } from './audioUtils.js';

/**
 * High-level wrapper: fetches text from URLs, chunks to TTS, then merges all chunks.
 * @param {string[]} urls - List of URLs containing text.
 * @param {string} outputPath - Where the merged MP3 should be written.
 * @returns {Promise<string>} Path to the merged audio file.
 */
export async function processURLsToMergedTTS(urls, outputPath) {
  const chunkFiles = await processTextFromURLs(urls);
  const merged = await mergeAudioFiles(chunkFiles, outputPath);
  return merged;
}
