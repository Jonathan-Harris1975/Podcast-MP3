import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { processTextFromURLs } from './textProcessor.js';
import { mergeAudioFiles } from './audioUtils.js';
import { uploadToR2, uploadMultipleToR2 } from './r2.js';
import logger from './logger.js';
import pLimit from 'p-limit';

// Initialize Google TTS client
const ttsClient = new TextToSpeechClient();

// CRITICAL: Limit concurrent TTS operations
const ttsLimit = pLimit(3); // Maximum 3 concurrent TTS calls

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

/**
 * CRITICAL: Process text chunks with TTS and upload to R2
 * This is the main function that handles your chunked TTS processing
 * @param {Array} textChunks - Array of text chunks to process
 * @param {Object} voice - Google TTS voice configuration
 * @param {Object} audioConfig - Google TTS audio configuration
 * @param {string} prefix - R2 key prefix for uploads
 * @returns {Promise<Object>} Processing results with URLs
 */
export async function processChunkedTTSToR2(textChunks, voice, audioConfig, prefix) {
  const startTime = Date.now();
  
  logger.info('TTS Processing Started', {
    chunkCount: textChunks.length,
    voice: voice.name || voice.languageCode,
    prefix,
    totalTextLength: textChunks.reduce((sum, chunk) => sum + (chunk.text || chunk).length, 0)
  });

  // Validate inputs
  if (!textChunks || textChunks.length === 0) {
    throw new Error('No text chunks provided for TTS processing');
  }

  if (textChunks.length > 100) {
    throw new Error(`Too many chunks: ${textChunks.length}. Maximum is 100 chunks.`);
  }

  try {
    // CRITICAL: Process all chunks with timeout and concurrency control
    const results = await Promise.all(
      textChunks.map((chunk, index) => 
        ttsLimit(async () => {
          return await processSingleChunkWithTimeout(chunk, index, voice, audioConfig, prefix, textChunks.length);
        })
      )
    );

    // Calculate final metrics
    const totalTime = Date.now() - startTime;
    const totalBytes = results.reduce((sum, result) => sum + (result.size || 0), 0);
    const successfulChunks = results.filter(r => r.success);
    const failedChunks = results.filter(r => !r.success);

    logger.info('TTS Processing Complete', {
      totalTimeMs: totalTime,
      totalChunks: textChunks.length,
      successful: successfulChunks.length,
      failed: failedChunks.length,
      totalBytes,
      averageTimePerChunk: Math.round(totalTime / textChunks.length),
      throughputMbps: ((totalBytes / 1024 / 1024) / (totalTime / 1000)).toFixed(2)
    });

    // If any chunks failed, log details but don't fail the entire request
    if (failedChunks.length > 0) {
      logger.error('Some TTS chunks failed', {
        failedCount: failedChunks.length,
        failedIndices: failedChunks.map(f => f.index),
        errors: failedChunks.map(f => f.error)
      });
    }

    // Sort results by index to maintain order
    const sortedResults = successfulChunks.sort((a, b) => a.index - b.index);

    return {
      count: successfulChunks.length,
      totalChunks: textChunks.length,
      chunks: sortedResults,
      summaryBytesApprox: totalBytes,
      processingTimeMs: totalTime,
      failed: failedChunks.length,
      prefix
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error('TTS Processing Failed', {
      error: error.message,
      totalTimeMs: totalTime,
      chunkCount: textChunks.length,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * CRITICAL: Process a single chunk with comprehensive timeout handling
 * @param {string|Object} chunk - Text chunk to process
 * @param {number} index - Chunk index
 * @param {Object} voice - TTS voice config
 * @param {Object} audioConfig - TTS audio config
 * @param {string} prefix - R2 key prefix
 * @param {number} totalChunks - Total number of chunks
 * @returns {Promise<Object>} Processing result
 */
async function processSingleChunkWithTimeout(chunk, index, voice, audioConfig, prefix, totalChunks) {
  const chunkStartTime = Date.now();
  const text = typeof chunk === 'string' ? chunk : chunk.text;
  const chunkId = `${index + 1}/${totalChunks}`;

  logger.info(`TTS Chunk ${chunkId} Starting`, {
    index,
    textLength: text.length,
    textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
  });

  try {
    // Step 1: Generate audio with TTS (with timeout)
    logger.info(`TTS Chunk ${chunkId} - Calling Google TTS API`);
    
    const ttsRequest = {
      input: { text },
      voice: {
        languageCode: voice.languageCode || 'en-US',
        name: voice.name,
        ssmlGender: voice.ssmlGender || 'NEUTRAL'
      },
      audioConfig: {
        audioEncoding: audioConfig.audioEncoding || 'MP3',
        speakingRate: audioConfig.speakingRate || 1.0,
        pitch: audioConfig.pitch || 0.0,
        volumeGainDb: audioConfig.volumeGainDb || 0.0,
        sampleRateHertz: audioConfig.sampleRateHertz || 24000
      }
    };

    // CRITICAL: Add timeout to TTS API call
    const ttsPromise = ttsClient.synthesizeSpeech(ttsRequest);
    const ttsTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Google TTS API timeout after 60 seconds for chunk ${chunkId}`));
      }, 60000); // 60 seconds for TTS
    });

    const [response] = await Promise.race([ttsPromise, ttsTimeoutPromise]);
    const audioBuffer = response.audioContent;
    const ttsTime = Date.now() - chunkStartTime;

    logger.info(`TTS Chunk ${chunkId} - TTS Complete`, {
      ttsTimeMs: ttsTime,
      audioBytes: audioBuffer.length,
      audioSizeMB: (audioBuffer.length / 1024 / 1024).toFixed(2)
    });

    // Step 2: Upload to R2 (with timeout via the R2 module)
    logger.info(`TTS Chunk ${chunkId} - Uploading to R2`);
    
    const uploadKey = `${prefix}/${String(index).padStart(3, '0')}.mp3`;
    const uploadStartTime = Date.now();
    
    const publicUrl = await uploadToR2(uploadKey, audioBuffer, 'audio/mpeg');
    const uploadTime = Date.now() - uploadStartTime;
    const totalTime = Date.now() - chunkStartTime;

    logger.info(`TTS Chunk ${chunkId} - Complete Success`, {
      totalTimeMs: totalTime,
      ttsTimeMs: ttsTime,
      uploadTimeMs: uploadTime,
      url: publicUrl,
      size: audioBuffer.length
    });

    return {
      index,
      success: true,
      url: publicUrl,
      key: uploadKey,
      size: audioBuffer.length,
      textLength: text.length,
      processingTimeMs: totalTime,
      ttsTimeMs: ttsTime,
      uploadTimeMs: uploadTime,
      bytesApprox: audioBuffer.length // For backward compatibility
    };

  } catch (error) {
    const totalTime = Date.now() - chunkStartTime;
    
    logger.error(`TTS Chunk ${chunkId} - Failed`, {
      index,
      error: error.message,
      totalTimeMs: totalTime,
      textLength: text.length,
      errorType: error.name,
      stack: error.stack
    });

    return {
      index,
      success: false,
      error: error.message,
      textLength: text.length,
      processingTimeMs: totalTime
    };
  }
}

/**
 * Batch process text chunks with intelligent chunking and retry logic
 * @param {string} fullText - Complete text to process
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing results
 */
export async function processLongTextToR2(fullText, options = {}) {
  const {
    voice = { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
    audioConfig = { audioEncoding: 'MP3', speakingRate: 1.0 },
    prefix = `tts-${Date.now()}`,
    maxChunkSize = 4000,
    maxChunks = 50
  } = options;

  logger.info('Long Text Processing Started', {
    textLength: fullText.length,
    textSizeKB: (fullText.length / 1024).toFixed(2),
    maxChunkSize,
    maxChunks,
    prefix
  });

  try {
    // Import text chunking utility (assuming you have this)
    const { chunkTextForSSML } = await import('./textProcessor.js');
    
    // Chunk the text intelligently
    const textChunks = chunkTextForSSML(fullText, {
      maxChunkSize,
      preserveWords: true,
      preserveSentences: true
    });

    if (textChunks.length > maxChunks) {
      throw new Error(`Text too long: generated ${textChunks.length} chunks, maximum is ${maxChunks}`);
    }

    logger.info('Text Chunking Complete', {
      originalLength: fullText.length,
      chunkCount: textChunks.length,
      averageChunkSize: Math.round(fullText.length / textChunks.length),
      estimatedProcessingTime: `${Math.round((textChunks.length * 10) / 60)} minutes`
    });

    // Process all chunks
    return await processChunkedTTSToR2(textChunks, voice, audioConfig, prefix);

  } catch (error) {
    logger.error('Long Text Processing Failed', {
      error: error.message,
      textLength: fullText.length,
      options,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Health check for TTS service
 * @returns {Promise<Object>} Health check results
 */
export async function healthCheckTTS() {
  try {
    const testText = "This is a health check for the TTS service.";
    const testVoice = { languageCode: 'en-US', name: 'en-US-Standard-D' };
    const testAudioConfig = { audioEncoding: 'MP3' };
    
    const startTime = Date.now();
    
    // Test TTS API
    const [response] = await Promise.race([
      ttsClient.synthesizeSpeech({
        input: { text: testText },
        voice: testVoice,
        audioConfig: testAudioConfig
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('TTS health check timeout')), 10000);
      })
    ]);

    const duration = Date.now() - startTime;
    
    return {
      status: 'healthy',
      ttsResponseTime: duration,
      audioBytes: response.audioContent.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    logger.error('TTS Health Check Failed', { error: error.message });
    
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
      }
