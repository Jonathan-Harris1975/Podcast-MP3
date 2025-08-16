// src/utils/textProcessor.js

/**
 * Text processing utilities
 */

/**
 * Clean and normalize text for TTS processing
 * @param {string} text - Input text to process
 * @returns {string} - Processed text
 */
export function cleanText(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    return text
        .trim()
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/[^\w\s.,!?;:-]/g, ''); // Remove special characters except basic punctuation
}

/**
 * Split text into chunks suitable for TTS processing
 * @param {string} text - Input text to chunk
 * @param {number} maxLength - Maximum length per chunk (default: 500)
 * @returns {string[]} - Array of text chunks
 */
export function chunkText(text, maxLength = 500) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunks = [];
    let currentChunk = '';
    
    for (const sentence of sentences) {
        const trimmedSentence = sentence.trim();
        
        if (currentChunk.length + trimmedSentence.length + 1 <= maxLength) {
            currentChunk += (currentChunk ? '. ' : '') + trimmedSentence;
        } else {
            if (currentChunk) {
                chunks.push(currentChunk + '.');
            }
            currentChunk = trimmedSentence;
        }
    }
    
    if (currentChunk) {
        chunks.push(currentChunk + '.');
    }
    
    return chunks;
}

/**
 * Validate text for TTS processing
 * @param {string} text - Text to validate
 * @returns {boolean} - Whether text is valid for TTS
 */
export function validateText(text) {
    return text && 
           typeof text === 'string' && 
           text.trim().length > 0 && 
           text.trim().length <= 5000; // Reasonable limit for TTS
}

// Default export
export default {
    cleanText,
    chunkText,
    validateText
};
