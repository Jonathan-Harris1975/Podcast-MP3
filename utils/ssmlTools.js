import { generateDynamicSSML } from './chatgptSSMLGenerator.js';

const DEFAULT_MAX_CHUNK_BYTES = 4000;

// Basic SSML wrapper function - fallback if generateDynamicSSML fails
function convertToSSML(text) {
  // Basic SSML structure with UK voice settings
  const voice = process.env.DEFAULT_VOICE || 'en-GB-Wavenet-B';
  const rate = process.env.DEFAULT_SPEAKING_RATE || '1.25';
  const pitch = process.env.DEFAULT_PITCH || '-2.0st';
  const volume = process.env.DEFAULT_VOLUME || '+1.5dB';

  // Clean text and add basic formatting
  const cleanText = text
    .replace(/\s+/g, ' ')
    .trim()
    // Add pauses after punctuation
    .replace(/([.!?])\s+/g, '$1<break time="500ms"/> ')
    .replace(/([,;:])\s+/g, '$1<break time="300ms"/> ');

  return `<speak>
    <voice name="${voice}">
      <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
        ${cleanText}
      </prosody>
    </voice>
  </speak>`;
}

// Basic formatting function as fallback
function editAndFormat(chunk) {
  // Simple formatting - you can enhance this based on your needs
  return chunk
    .replace(/\s+/g, ' ')
    .trim()
    // Ensure proper SSML structure
    .replace(/^(?!<speak>)/, '<speak>')
    .replace(/(?!<\/speak>)$/, '</speak>');
}

export async function chunkTextToSSML(text, maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES) {
  try {
    // First try to use the dynamic SSML generator
    const dynamicSSML = await generateDynamicSSML(text, { 
      maxBytes: maxChunkBytes 
    });
    
    // If it returns multiple chunks, return them
    if (Array.isArray(dynamicSSML) && dynamicSSML.length > 1) {
      return dynamicSSML.map(chunk => editAndFormat(chunk));
    }
    
    // If it's a single item array, check if it needs chunking
    const singleSSML = Array.isArray(dynamicSSML) ? dynamicSSML[0] : dynamicSSML;
    
    if (Buffer.byteLength(singleSSML, 'utf8') <= maxChunkBytes) {
      return [editAndFormat(singleSSML)];
    }
    
    // If still too large, fall through to manual chunking
    text = singleSSML;
  } catch (error) {
    console.warn('Dynamic SSML generation failed, using fallback:', error.message);
    // Use basic SSML conversion as fallback
    text = convertToSSML(text);
  }

  // Manual chunking logic
  const chunks = [];
  let currentChunk = '';
  let currentChunkBytes = 0;

  // Split by sentences, preserving SSML tags
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];

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

  // Apply editAndFormat to all chunks
  const processedChunks = chunks.map(chunk => editAndFormat(chunk));

  return processedChunks;
}

// Export the basic converter as well in case it's needed elsewhere
export { convertToSSML };
