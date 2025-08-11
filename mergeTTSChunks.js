// mergeTTSChunks.js
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import util from 'util';
import logger from './logger.js';
import { uploadToR2Merged } from './r2merged.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execPromise = util.promisify(exec);

/**
 * Merge TTS chunk files into a single MP3 and upload to R2 merged bucket
 * @param {string[]} chunkFiles - Array of local file paths to merge
 * @param {string} sessionId - Unique session identifier
 */
export default async function mergeTTSChunks(chunkFiles = [], sessionId = 'session') {
  if (!Array.isArray(chunkFiles) || chunkFiles.length === 0) {
    throw new Error('No chunk files provided to mergeTTSChunks');
  }

  const outputFile = path.join(__dirname, `${sessionId}_merged_${Date.now()}.mp3`);
  const fileList = path.join(__dirname, `${sessionId}_filelist.txt`);

  try {
    // Create a list file for ffmpeg concat
    const listContent = chunkFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    await fs.writeFile(fileList, listContent, 'utf8');

    // Merge with ffmpeg (concat demuxer)
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${fileList}" -c copy "${outputFile}"`;
    logger.info('Merging audio with command:', cmd);
    await execPromise(cmd);

    // Upload merged file
    const data = await fs.readFile(outputFile);
    const key = `${sessionId}/merged_${Date.now()}.mp3`;
    const mergedUrl = await uploadToR2Merged(key, data);

    logger.info(`Audio merged successfully: ${mergedUrl}`);
    return mergedUrl;
  } catch (error) {
    logger.error('Audio merge failed:', error);
    throw new Error(`Audio processing failed: ${error.message}`);
  } finally {
    // Best-effort cleanup
    try { await fs.unlink(fileList).catch(()=>{}); } catch(e){}
    try { await fs.unlink(outputFile).catch(()=>{}); } catch(e){}
  }
}
