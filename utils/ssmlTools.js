// utils/ssmlTools.js
import { validateSSML } from './ssmlValidator.js';
import logger from './logger.js';

/**
 * Converts abbreviations and special terms to proper SSML pronunciation
 */
function convertSpecialTerms(text) {
  if (!text) return '';
  
  return text
    // Single-letter abbreviations (AI, BBC, etc.)
    .replace(/\b(AI|BBC|NASA|FBI|CIA|NSA|UK|US|EU|UN)\b/gi, 
      match => `<say-as interpret-as="characters">${match.split('').join(' ')}</say-as>`)
    
    // Common tech terms
    .replace(/\b(API|JSON|SQL|CSS|HTML|JS|TS|HTTP|URL)\b/gi,
      match => `<sub alias="${match.replace(/([A-Z])/g, ' $1').trim()}">${match}</sub>`)
    
    // Measurements
    .replace(/(\d+)\s?(kg|km|mm|cm|ml|l)/gi,
      '<say-as interpret-as="unit">$1 $2</say-as>');
}

/**
 * Formats numbers, dates, and currencies for UK English
 */
function formatUKContent(text) {
  if (!text) return '';
  
  return text
    // Dates (DD/MM/YYYY or DD-MM-YYYY)
    .replace(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/g,
      '<say-as interpret-as="date" format="dmy">$1/$2/$3</say-as>')
    
    // Times (12-hour with optional am/pm)
    .replace(/(\d{1,2}):(\d{2})\s?(am|pm)?/gi, (_, h, m, p) => {
      const period = p ? ` ${p.toLowerCase()}` : '';
      return `<say-as interpret-as="time" format="hms12">${h}:${m}${period}</say-as>`;
    })
    
    // Currency (£XX.XX)
    .replace(/£(\d+\.?\d*)/g,
      '<say-as interpret-as="currency" currency="GBP">$1</say-as>')
    
    // Phone numbers
    .replace(/(?:\+44|0)\d{10}/g,
      '<say-as interpret-as="telephone">$&</say-as>');
}

/**
 * Adds natural pauses for punctuation
 */
function addSpeechPauses(text) {
  if (!text) return '';
  
  return text
    .replace(/,/g, '<break time="300ms"/>')
    .replace(/;/g, '<break time="500ms"/>')
    .replace(/\.\s/g, '<break time="700ms"/>');
}

/**
 * Main function to convert text to UK-optimised SSML
 */
export function makeUKSSML(text, strict = true) {
  if (!text?.trim()) return '<speak></speak>';

  try {
    // Process text step-by-step instead of using the pipeline operator
    let processed = convertSpecialTerms(text);
    processed = formatUKContent(processed);
    processed = addSpeechPauses(processed);

    // Wrap in speak tags
    const ssml = `<speak>${processed}</speak>`;
    
    // Validate the SSML
    const validation = validateSSML(ssml, strict);
    if (!validation.isValid) {
      logger.warn('SSML validation warnings:', validation.warnings);
    }

    return ssml;
  } catch (error) {
    logger.error('SSML generation failed:', error);
    // Fallback to minimal valid SSML
    return `<speak>${text}</speak>`;
  }
}

/**
 * Chunk long text into SSML-safe segments
 */
export function chunkTextToSSML(text, maxLength = 4500) {
  if (!text?.trim()) return [];
  
  const segments = [];
  let currentChunk = '';
  
  // Split on sentences when possible
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxLength) {
      if (currentChunk) segments.push(makeUKSSML(currentChunk));
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  
  if (currentChunk) segments.push(makeUKSSML(currentChunk));
  
  return segments;
}

/**
 * Generate SSML with prosody adjustments
 */
export function withProsody(text, options = {}) {
  const { rate = '100%', pitch = '0%', volume = '0dB' } = options;
  return `
    <speak>
      <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
        ${makeUKSSML(text).replace(/<\/?speak>/g, '')}
      </prosody>
    </speak>
  `;
}

export default {
  makeUKSSML,
  chunkTextToSSML,
  withProsody,
  convertSpecialTerms,
  formatUKContent
};
