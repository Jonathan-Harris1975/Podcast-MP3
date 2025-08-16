// src/utils/textProcessor.js

/**
 * Text processing utilities
 */

/**
 * Process text from multiple URLs
 * @param {string[]} urls - Array of URLs to fetch text from
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processed text result
 */
export async function processTextFromURLs(urls, options = {}) {
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return {
            success: false,
            text: '',
            sources: [],
            error: 'No URLs provided'
        };
    }

    const { 
        maxLength = 10000, 
        cleanText: shouldClean = true,
        joinSeparator = '\n\n',
        timeout = 10000 
    } = options;

    const results = [];
    const errors = [];

    try {
        // Process each URL
        for (const url of urls) {
            try {
                // Basic URL validation
                if (!url || typeof url !== 'string' || !url.startsWith('http')) {
                    errors.push(`Invalid URL: ${url}`);
                    continue;
                }

                // For now, return a placeholder since we can't fetch external URLs
                // In a real implementation, you would use fetch() or a similar library
                const mockText = `Content from ${url}`;
                
                results.push({
                    url,
                    text: mockText,
                    success: true
                });

            } catch (error) {
                errors.push(`Failed to process ${url}: ${error.message}`);
                results.push({
                    url,
                    text: '',
                    success: false,
                    error: error.message
                });
            }
        }

        // Combine all successful text results
        const combinedText = results
            .filter(result => result.success && result.text)
            .map(result => result.text)
            .join(joinSeparator);

        // Clean and validate the combined text
        const processedText = shouldClean ? cleanText(combinedText) : combinedText;
        
        // Truncate if too long
        const finalText = processedText.length > maxLength 
            ? processedText.substring(0, maxLength) + '...' 
            : processedText;

        return {
            success: results.some(r => r.success),
            text: finalText,
            sources: results,
            errors: errors.length > 0 ? errors : undefined,
            metadata: {
                urlsProcessed: urls.length,
                successfulUrls: results.filter(r => r.success).length,
                totalLength: finalText.length,
                truncated: processedText.length > maxLength
            }
        };

    } catch (error) {
        return {
            success: false,
            text: '',
            sources: results,
            error: error.message,
            errors: [...errors, error.message]
        };
    }
}

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
    processTextFromURLs,
    cleanText,
    chunkText,
    validateText
};
