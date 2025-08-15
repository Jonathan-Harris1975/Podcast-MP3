// utils/ssmlValidator.js
import logger from './logger.js';

// UK-specific validation rules
const UK_SPECIFIC_RULES = {
  DATE_FORMAT: /(\d{1,2})\/(\d{1,2})\/(\d{4})/g,
  CURRENCY_SYMBOLS: /[£$€]/,
  ABBREVIATIONS: /\b(Dr|Mr|Mrs|Ms|Prof|vs|e\.g|i\.e|etc)\./gi,
  POSTCODES: /[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}/g,
  TELEPHONE: /(?:\+44|0)\d{10}/g
};

// Forbidden tags in strict mode
const FORBIDDEN_TAGS = [
  'voice', 'sub', 'emphasis', 'lang'
];

// Maximum recommended values for prosody
const PROSODY_LIMITS = {
  rate: { min: 60, max: 200 }, // percentage
  pitch: { min: -12, max: +12 }, // semitones
  volume: { min: -6, max: +6 } // decibels
};

/**
 * Enhanced SSML validator with UK-specific rules
 */
export function validateSSML(ssml, strict = true) {
  const errors = [];
  const warnings = [];
  
  if (!ssml || typeof ssml !== 'string' || !ssml.trim()) {
    errors.push('SSML content is empty');
    return { errors, warnings, isValid: false };
  }

  // Basic structural validation
  if (!hasSpeakWrap(ssml)) {
    errors.push('SSML must be wrapped in <speak>...</speak>');
  }

  if (!hasBalancedTags(ssml)) {
    errors.push('Mismatched or malformed XML tags');
  }

  // Content validation
  const contentWarnings = validateContent(ssml);
  warnings.push(...contentWarnings);

  // UK-specific validation if UK voice detected
  if (process.env.DEFAULT_VOICE?.includes('en-GB')) {
    const ukWarnings = validateUKContent(ssml);
    warnings.push(...ukWarnings);
  }

  // Strict mode validation
  if (strict) {
    const strictErrors = validateStrictMode(ssml);
    errors.push(...strictErrors);
  }

  // Prosody validation
  const prosodyIssues = validateProsody(ssml);
  warnings.push(...prosodyIssues);

  return {
    errors,
    warnings,
    isValid: errors.length === 0,
    isUK: process.env.DEFAULT_VOICE?.includes('en-GB')
  };
}

function hasSpeakWrap(ssml) {
  const trimmed = ssml.trim();
  return trimmed.startsWith('<speak') && trimmed.endsWith('</speak>');
}

function hasBalancedTags(ssml) {
  const tagStack = [];
  const tagRegex = /<\/?([a-z]+)[^>]*>/gi;
  let match;
  
  while ((match = tagRegex.exec(ssml)) !== null) {
    const [fullTag, tagName] = match;
    if (fullTag.startsWith('</')) {
      if (tagStack.pop() !== tagName) {
        return false;
      }
    } else if (!fullTag.endsWith('/>')) {
      tagStack.push(tagName);
    }
  }
  
  return tagStack.length === 0;
}

function validateContent(ssml) {
  const warnings = [];
  const innerText = ssml.replace(/<[^>]+>/g, '');
  
  // Long runs without breaks
  if (innerText.length > 200 && !ssml.includes('<break')) {
    warnings.push('Long text segment without breaks - consider adding <break> tags');
  }

  // Excessive punctuation
  if ((innerText.match(/[.!?]{3,}/g) || []).length > 3) {
    warnings.push('Excessive punctuation may affect speech quality');
  }

  return warnings;
}

function validateUKContent(ssml) {
  const warnings = [];
  const innerText = ssml.replace(/<[^>]+>/g, '');

  // Check for non-UK date formats
  if (innerText.match(UK_SPECIFIC_RULES.DATE_FORMAT)) {
    warnings.push('Date format detected - ensure dates use UK format (DD/MM/YYYY)');
  }

  // Check for non-£ currency symbols
  if (innerText.match(UK_SPECIFIC_RULES.CURRENCY_SYMBOLS)) {
    warnings.push('Non-£ currency symbol detected - consider converting to GBP');
  }

  return warnings;
}

function validateStrictMode(ssml) {
  const errors = [];
  const tagRegex = /<([a-z]+)(?:\s|>)/gi;
  let match;

  while ((match = tagRegex.exec(ssml)) !== null) {
    const tagName = match[1].toLowerCase();
    if (FORBIDDEN_TAGS.includes(tagName)) {
      errors.push(`Tag <${tagName}> is not allowed in strict mode`);
    }
  }

  return errors;
}

function validateProsody(ssml) {
  const warnings = [];
  const prosodyRegex = /<prosody\s+([^>]+)>/gi;
  let match;

  while ((match = prosodyRegex.exec(ssml)) !== null) {
    const attrs = match[1];
    const rateMatch = attrs.match(/rate="([^"]+)"/i);
    const pitchMatch = attrs.match(/pitch="([^"]+)"/i);
    const volumeMatch = attrs.match(/volume="([^"]+)"/i);

    if (rateMatch) {
      const rate = parseFloat(rateMatch[1]);
      if (rate < PROSODY_LIMITS.rate.min || rate > PROSODY_LIMITS.rate.max) {
        warnings.push(`Prosody rate ${rate}% is outside recommended range (${PROSODY_LIMITS.rate.min}-${PROSODY_LIMITS.rate.max}%)`);
      }
    }

    if (pitchMatch) {
      const pitch = parseFloat(pitchMatch[1]);
      if (pitch < PROSODY_LIMITS.pitch.min || pitch > PROSODY_LIMITS.pitch.max) {
        warnings.push(`Prosody pitch ${pitch}st is outside recommended range (${PROSODY_LIMITS.pitch.min}-${PROSODY_LIMITS.pitch.max}st)`);
      }
    }

    if (volumeMatch) {
      const volume = parseFloat(volumeMatch[1]);
      if (volume < PROSODY_LIMITS.volume.min || volume > PROSODY_LIMITS.volume.max) {
        warnings.push(`Prosody volume ${volume}dB is outside recommended range (${PROSODY_LIMITS.volume.min}-${PROSODY_LIMITS.volume.max}dB)`);
      }
    }
  }

  return warnings;
}

export default {
  validateSSML,
  UK_SPECIFIC_RULES,
  FORBIDDEN_TAGS,
  PROSODY_LIMITS
};
