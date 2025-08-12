import { validateSSML } from './ssmlValidator.js';
import logger from './logger.js';

const UK_PHONETICS = {
  'AI': 'A I',
  'API': 'A P I',
  'SQL': 'S Q L',
  'HTTP': 'H T T P'
};

export function makeUKSSML(text, strict = true) {
  if (!text?.trim()) return '<speak></speak>';

  let processed = text
    .replace(new RegExp(Object.keys(UK_PHONETICS).join('|'), 
      match => `<sub alias="${UK_PHONETICS[match.toUpperCase()]}">${match}</sub>`)
    .replace(/(\d+)\/(\d+)\/(\d{4})/g, '<say-as interpret-as="date" format="dmy">$1/$2/$3</say-as>')
    .replace(/£(\d+\.?\d*)/g, '<say-as interpret-as="currency" currency="GBP">$1</say-as>')
    .replace(/(?:\+44|0)\d{10}/g, match => `<say-as interpret-as="telephone">${match}</say-as>`);

  const ssml = `
    <speak>
      <prosody 
        rate="${process.env.DEFAULT_SPEAKING_RATE || 1.15}" 
        pitch="${process.env.DEFAULT_PITCH || '-3.0'}st"
        volume="${process.env.DEFAULT_VOLUME || '+1.5dB'}"
      >
        ${processed}
      </prosody>
    </speak>
  `;

  const validation = validateSSML(ssml, strict);
  if (!validation.isValid) {
    logger.warn('SSML validation warnings', validation.warnings);
  }

  return ssml;
}

export function chunkTextToSSML(text, maxLength = 4500, overlap = 50) {
  if (!text?.trim()) return [];
  
  const segments = [];
  let currentChunk = '';
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxLength) {
      if (currentChunk) {
        segments.push(makeUKSSML(currentChunk));
        currentChunk = currentChunk.slice(-overlap) + sentence;
      } else {
        currentChunk = sentence;
      }
    } else {
      currentChunk += sentence;
    }
  }
  
  if (currentChunk) segments.push(makeUKSSML(currentChunk));
  return segments;
}

export default {
  makeUKSSML,
  chunkTextToSSML
};
