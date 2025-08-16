// src/utils/audioUtils.js

/**
 * Audio processing utilities for TTS service
 */

/**
 * Merge multiple audio files into a single file
 * Note: This is a placeholder implementation. For production use, 
 * you would need a proper audio library like ffmpeg or similar.
 * @param {Buffer[]} audioBuffers - Array of audio buffers to merge
 * @param {string} encoding - Audio encoding format
 * @returns {Promise<Buffer>} - Merged audio buffer
 */
export async function mergeAudioFiles(audioBuffers, encoding = 'MP3') {
    if (!audioBuffers || !Array.isArray(audioBuffers) || audioBuffers.length === 0) {
        return Buffer.alloc(0);
    }
    
    // For single buffer, return as-is
    if (audioBuffers.length === 1) {
        return audioBuffers[0];
    }
    
    try {
        // Calculate total length
        const totalLength = audioBuffers.reduce((sum, buffer) => {
            return sum + (Buffer.isBuffer(buffer) ? buffer.length : 0);
        }, 0);
        
        // Create merged buffer
        const mergedBuffer = Buffer.alloc(totalLength);
        let offset = 0;
        
        // Copy all buffers into the merged buffer
        for (const buffer of audioBuffers) {
            if (Buffer.isBuffer(buffer) && buffer.length > 0) {
                buffer.copy(mergedBuffer, offset);
                offset += buffer.length;
            }
        }
        
        return mergedBuffer;
    } catch (error) {
        console.warn('Error merging audio files:', error);
        // Return the first valid buffer as fallback
        const firstValidBuffer = audioBuffers.find(buffer => Buffer.isBuffer(buffer) && buffer.length > 0);
        return firstValidBuffer || Buffer.alloc(0);
    }
}

/**
 * Calculate approximate audio duration based on text length and speaking rate
 * @param {string} text - Input text
 * @param {number} speakingRate - Speaking rate (0.25 to 4.0, default 1.0)
 * @param {number} wordsPerMinute - Base words per minute (default 150)
 * @returns {number} - Estimated duration in seconds
 */
export function estimateAudioDuration(text, speakingRate = 1.0, wordsPerMinute = 150) {
    if (!text || typeof text !== 'string') {
        return 0;
    }
    
    const wordCount = text.trim().split(/\s+/).length;
    const baseMinutes = wordCount / wordsPerMinute;
    const adjustedMinutes = baseMinutes / speakingRate;
    
    return Math.ceil(adjustedMinutes * 60); // Return seconds
}

/**
 * Estimate audio file size based on encoding and duration
 * @param {number} durationSeconds - Duration in seconds
 * @param {string} encoding - Audio encoding (MP3, LINEAR16, OGG_OPUS)
 * @param {number} sampleRateHertz - Sample rate (default 24000)
 * @returns {number} - Estimated file size in bytes
 */
export function estimateAudioSize(durationSeconds, encoding = 'MP3', sampleRateHertz = 24000) {
    if (!durationSeconds || durationSeconds <= 0) {
        return 0;
    }
    
    let bytesPerSecond;
    
    switch (encoding.toUpperCase()) {
        case 'MP3':
            // MP3 ~128kbps average
            bytesPerSecond = 16000; // 128 kbps / 8 bits per byte
            break;
        case 'LINEAR16':
            // 16-bit PCM
            bytesPerSecond = sampleRateHertz * 2; // 2 bytes per sample
            break;
        case 'OGG_OPUS':
            // Opus ~64kbps average
            bytesPerSecond = 8000; // 64 kbps / 8 bits per byte
            break;
        default:
            // Default to MP3 estimate
            bytesPerSecond = 16000;
    }
    
    return Math.ceil(durationSeconds * bytesPerSecond);
}

/**
 * Generate audio file name with proper extension
 * @param {string} prefix - File prefix
 * @param {number} index - Chunk index
 * @param {string} encoding - Audio encoding
 * @returns {string} - Generated filename
 */
export function generateAudioFilename(prefix, index, encoding = 'MP3') {
    const paddedIndex = index.toString().padStart(3, '0');
    const extension = getFileExtension(encoding);
    
    return `${prefix}-${paddedIndex}.${extension}`;
}

/**
 * Get file extension for audio encoding
 * @param {string} encoding - Audio encoding
 * @returns {string} - File extension
 */
export function getFileExtension(encoding) {
    switch (encoding.toUpperCase()) {
        case 'MP3':
            return 'mp3';
        case 'LINEAR16':
            return 'wav';
        case 'OGG_OPUS':
            return 'ogg';
        case 'MULAW':
        case 'ALAW':
            return 'wav';
        default:
            return 'mp3';
    }
}

/**
 * Validate audio configuration
 * @param {Object} audioConfig - Audio configuration object
 * @returns {Object} - Validation result {valid: boolean, errors: string[]}
 */
export function validateAudioConfig(audioConfig) {
    const errors = [];
    
    if (!audioConfig) {
        errors.push('Audio configuration is required');
        return { valid: false, errors };
    }
    
    // Check encoding
    const validEncodings = ['MP3', 'LINEAR16', 'OGG_OPUS', 'MULAW', 'ALAW'];
    if (audioConfig.audioEncoding && !validEncodings.includes(audioConfig.audioEncoding.toUpperCase())) {
        errors.push(`Invalid audio encoding. Must be one of: ${validEncodings.join(', ')}`);
    }
    
    // Check speaking rate
    if (audioConfig.speakingRate !== undefined) {
        if (typeof audioConfig.speakingRate !== 'number' || 
            audioConfig.speakingRate < 0.25 || 
            audioConfig.speakingRate > 4.0) {
            errors.push('Speaking rate must be between 0.25 and 4.0');
        }
    }
    
    // Check pitch
    if (audioConfig.pitch !== undefined) {
        if (typeof audioConfig.pitch !== 'number' || 
            audioConfig.pitch < -20.0 || 
            audioConfig.pitch > 20.0) {
            errors.push('Pitch must be between -20.0 and 20.0');
        }
    }
    
    // Check volume gain
    if (audioConfig.volumeGainDb !== undefined) {
        if (typeof audioConfig.volumeGainDb !== 'number' || 
            audioConfig.volumeGainDb < -96.0 || 
            audioConfig.volumeGainDb > 16.0) {
            errors.push('Volume gain must be between -96.0 and 16.0 dB');
        }
    }
    
    // Check sample rate
    if (audioConfig.sampleRateHertz !== undefined) {
        const validSampleRates = [8000, 16000, 22050, 24000, 32000, 44100, 48000];
        if (!validSampleRates.includes(audioConfig.sampleRateHertz)) {
            errors.push(`Invalid sample rate. Must be one of: ${validSampleRates.join(', ')}`);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Create default audio configuration
 * @param {Object} overrides - Configuration overrides
 * @returns {Object} - Default audio configuration
 */
export function createDefaultAudioConfig(overrides = {}) {
    return {
        audioEncoding: 'MP3',
        sampleRateHertz: 24000,
        speakingRate: 1.0,
        pitch: 0.0,
        volumeGainDb: 0.0,
        ...overrides
    };
}

/**
 * Convert audio buffer to base64
 * @param {Buffer} audioBuffer - Audio data buffer
 * @returns {string} - Base64 encoded audio
 */
export function bufferToBase64(audioBuffer) {
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
        return '';
    }
    
    return audioBuffer.toString('base64');
}

/**
 * Get MIME type for audio encoding
 * @param {string} encoding - Audio encoding
 * @returns {string} - MIME type
 */
export function getMimeType(encoding) {
    switch (encoding.toUpperCase()) {
        case 'MP3':
            return 'audio/mpeg';
        case 'LINEAR16':
            return 'audio/wav';
        case 'OGG_OPUS':
            return 'audio/ogg';
        case 'MULAW':
        case 'ALAW':
            return 'audio/wav';
        default:
            return 'audio/mpeg';
    }
}

/**
 * Process audio chunks for TTS service
 * @param {Buffer[]} audioChunks - Array of audio chunk buffers
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processed audio result
 */
export async function processAudioChunks(audioChunks, options = {}) {
    const { merge = false, encoding = 'MP3' } = options;
    
    if (!audioChunks || !Array.isArray(audioChunks)) {
        return { chunks: [], merged: null, totalSize: 0 };
    }
    
    const processedChunks = audioChunks.map((chunk, index) => ({
        index,
        buffer: chunk,
        size: Buffer.isBuffer(chunk) ? chunk.length : 0,
        base64: bufferToBase64(chunk)
    }));
    
    const totalSize = processedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    
    let merged = null;
    if (merge && audioChunks.length > 1) {
        merged = await mergeAudioFiles(audioChunks, encoding);
    }
    
    return {
        chunks: processedChunks,
        merged,
        totalSize,
        count: audioChunks.length
    };
}

// Default export with all functions
export default {
    mergeAudioFiles,
    estimateAudioDuration,
    estimateAudioSize,
    generateAudioFilename,
    getFileExtension,
    validateAudioConfig,
    createDefaultAudioConfig,
    bufferToBase64,
    getMimeType,
    processAudioChunks
};
