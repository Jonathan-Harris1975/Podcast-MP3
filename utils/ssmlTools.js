import { generateDynamicSSML } from './chatgptSSMLGenerator.js';
import logger from './logger.js';

const DEFAULT_MAX_CHUNK_BYTES = 4000;

// Basic SSML wrapper function - fallback if generateDynamicSSML fails
function convertToSSML(text) {
  // Clean text first - DON'T escape < and > as we need SSML tags to work
  const cleanText = text
    .replace(/\s+/g, ' ')
    .trim()
    // Only escape XML special characters that aren't SSML tags
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Add pauses after punctuation using environment variable
    .replace(/([.!?])\s+/g, `$1<break time="${process.env.SSML_BREAK_MS || 420}ms"/> `)
    .replace(/([,;:])\s+/g, '$1<break time="300ms"/> ');

  // Use environment variables for voice settings
  const voice = process.env.DEFAULT_VOICE || 'en-GB-Wavenet-D';
  const rate = process.env.DEFAULT_SPEAKING_RATE || '1.15';
  const pitch = process.env.DEFAULT_PITCH || '-3.0';
  const volume = process.env.DEFAULT_VOLUME || '+1.5dB';

  return `<speak>
    <voice name="${voice}">
      <prosody rate="${rate}" pitch="${pitch}st" volume="${volume}">
        ${cleanText}
      </prosody>
    </voice>
  </speak>`;
}

// Basic formatting function as fallback
function editAndFormat(chunk) {
  // If already wrapped in <speak>, return as-is (but validate it)
  if (chunk.trim().startsWith('<speak>') && chunk.trim().endsWith('</speak>')) {
    return chunk.trim();
  }
  
  // If it looks like it has SSML tags but no speak wrapper, add it
  if (chunk.includes('<voice') || chunk.includes('<prosody') || chunk.includes('<break')) {
    return `<speak>${chunk.trim()}</speak>`;
  }
  
  // For plain text, use convertToSSML function
  return convertToSSML(chunk);
}

export async function chunkTextToSSML(text, maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES) {
  logger.info('Starting chunkTextToSSML', { 
    textLength: text.length, 
    maxChunkBytes,
    ssmlEnabled: process.env.SSML_ENABLED 
  });

  try {
    // First try to use the dynamic SSML generator
    logger.info('Attempting dynamic SSML generation');
    const dynamicSSML = await generateDynamicSSML(text, { 
      maxBytes: maxChunkBytes 
    });
    
    logger.info('Dynamic SSML generation result', {
      type: typeof dynamicSSML,
      isArray: Array.isArray(dynamicSSML),
      length: Array.isArray(dynamicSSML) ? dynamicSSML.length : 1,
      firstSample: Array.isArray(dynamicSSML) ? dynamicSSML[0]?.substring(0, 200) : dynamicSSML?.substring(0, 200)
    });
    
    // If it returns multiple chunks, return them
    if (Array.isArray(dynamicSSML) && dynamicSSML.length > 1) {
      const formatted = dynamicSSML.map(chunk => editAndFormat(chunk));
      logger.info('Returning multiple SSML chunks', { count: formatted.length });
      return formatted;
    }
    
    // If it's a single item array, check if it needs chunking
    const singleSSML = Array.isArray(dynamicSSML) ? dynamicSSML[0] : dynamicSSML;
    
    if (Buffer.byteLength(singleSSML, 'utf8') <= maxChunkBytes) {
      const formatted = editAndFormat(singleSSML);
      logger.info('Returning single SSML chunk', { 
        length: formatted.length,
        hasSpeak: formatted.includes('<speak>'),
        sample: formatted.substring(0, 200)
      });
      return [formatted];
    }
    
    // If still too large, fall through to manual chunking
    logger.warn('Dynamic SSML too large, falling back to manual chunking');
    text = singleSSML;
  } catch (error) {
    logger.warn('Dynamic SSML generation failed, using fallback conversion', { 
      error: error.message,
      stack: error.stack
    });
    // Use basic SSML conversion as fallback
    text = convertToSSML(text);
    logger.info('Fallback SSML conversion applied', {
      hasSpeak: text.includes('<speak>'),
      sample: text.substring(0, 200)
    });
  }

  // Manual chunking logic
  logger.info('Starting manual chunking', { textLength: text.length });
  
  const chunks = [];
  let currentChunk = '';
  let currentChunkBytes = 0;

  // Split by sentences, preserving SSML tags
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  logger.info('Split into sentences', { count: sentences.length });

  for (const sentence of sentences) {
    const sentenceBytes = Buffer.byteLength(sentence, 'utf8');

    // If a single sentence is too large, split it further
    if (sentenceBytes > maxChunkBytes) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
        currentChunkBytes = 0;
      }
      
      // Split large sentence by words
      const words = sentence.split(' ');
      let wordChunk = '';
      
      for (const word of words) {
        const testChunk = wordChunk + (wordChunk ? ' ' : '') + word;
        const testBytes = Buffer.byteLength(testChunk, 'utf8');
        
        if (testBytes <= maxChunkBytes) {
          wordChunk = testChunk;
        } else {
          if (wordChunk.length > 0) {
            chunks.push(wordChunk);
          }
          wordChunk = word;
        }
      }
      
      if (wordChunk.length > 0) {
        currentChunk = wordChunk;
        currentChunkBytes = Buffer.byteLength(wordChunk, 'utf8');
      }
      continue;
    }

    if (currentChunkBytes + sentenceBytes <= maxChunkBytes) {
      currentChunk += sentence;
      currentChunkBytes += sentenceBytes;
    } else {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }
      currentChunk = sentence;
      currentChunkBytes = sentenceBytes;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  logger.info('Manual chunking complete', { 
    chunkCount: chunks.length,
    avgSize: Math.round(chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk, 'utf8'), 0) / chunks.length)
  });

  // Apply editAndFormat to all chunks
  const processedChunks = chunks.map((chunk, index) => {
    const formatted = editAndFormat(chunk);
    logger.info(`Chunk ${index} formatted`, {
      hasSpeak: formatted.includes('<speak>'),
      length: formatted.length,
      sample: formatted.substring(0, 150)
    });
    return formatted;
  });

  return processedChunks;
}

// Export the basic converter as well in case it's needed elsewhere
export { convertToSSML };
