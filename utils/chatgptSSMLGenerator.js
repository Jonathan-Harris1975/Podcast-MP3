import axios from 'axios';
import { validateSSML } from './ssmlValidator.js';
import { chunkTextToSSML } from './ssmlTools.js'; // Removed makeUKSSML import
import logger from './logger.js';

const GPT_MODEL = process.env.OPENAI_MODEL || 'gpt-4';
const GPT_TEMPERATURE = parseFloat(process.env.GPT_TEMPERATURE) || 0.5;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const MAX_SSML_BYTES = parseInt(process.env.MAX_SSML_CHUNK_BYTES) || 4000;
const SAFE_PROSODY_RATE = process.env.DEFAULT_SPEAKING_RATE || '1.15';
const SAFE_PITCH = process.env.DEFAULT_PITCH || '-3.0';
const SAFE_VOLUME = process.env.DEFAULT_VOLUME || '+1.5dB';

function byteLength(str) {
  return Buffer.byteLength(str, 'utf8');
}

function autoBreaks(ssml, minLen = 250) {
  // Insert <break> tags after long sentences, paragraphs using environment variable
  const breakTime = process.env.SSML_BREAK_MS || '420';
  return ssml.replace(/([.!?])(\s+)/g, (m, punc, space) => {
    return punc + `<break time="${breakTime}ms"/>` + space;
  });
}

export async function generateDynamicSSML(text, options = {}) {
  const {
    voice = process.env.DEFAULT_VOICE || 'en-GB-Wavenet-B',
    speakingRate = SAFE_PROSODY_RATE,
    pitch = SAFE_PITCH,
    strictValidation = true,
  } = options;

  // System prompt for ChatGPT
  const systemPrompt = `You are an expert SSML (Speech Synthesis Markup Language) engineer specializing in high-quality podcast audio production. Your task is to transform raw text into optimally tagged SSML for Google Cloud Text-to-Speech, specifically for voice ${voice}.

Key Guidelines:
1. Structure for ${voice} with ${speakingRate}x speed and ${pitch} pitch baseline
2. Use UK English formatting (day-month-year, GBP currency)
3. Apply natural pauses between paragraphs (500-700ms) and sentences (300ms)
4. Add moderate emphasis to key terms and proper nouns
5. Format all dates, numbers, acronyms with <say-as> tags
6. Include subtle prosody variations for vocal variety
7. Keep SSML valid and compatible with Google TTS
8. Maximum SSML length: ${MAX_SSML_BYTES} bytes (including tags)
9. If output exceeds byte limit, split into chunks and return them as an array.

Special Requirements:
- UK date format (DD/MM/YYYY)
- Telephone numbers in +44 format
- Technical terms spelled out (e.g., "API" as "A P I")
- Longer pauses (${process.env.SSML_BREAK_MS || 360}ms) for UK speech patterns`;

  let ssmlOutput;
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: GPT_MODEL,
        temperature: GPT_TEMPERATURE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        max_tokens: 4000
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    ssmlOutput = response.data.choices[0]?.message?.content;
    if (!ssmlOutput) throw new Error('No SSML returned from ChatGPT');

    // Normalize output (if array, join; if string, proceed)
    if (Array.isArray(ssmlOutput)) ssmlOutput = ssmlOutput.join(' ');

    // Insert breaks if missing
    ssmlOutput = autoBreaks(ssmlOutput);

    // Ensure prosody is safe
    ssmlOutput = ssmlOutput.replace(
      /<prosody([^>]*)>/g,
      `<prosody rate="${speakingRate}" pitch="${pitch}st" volume="${SAFE_VOLUME}">`
    );

    // Validate SSML
    const validation = validateSSML(ssmlOutput, strictValidation);
    if (!validation.isValid) {
      logger.warn('SSML validation warnings', validation.warnings);
      // Attempt to auto-correct or split if too large
      if (byteLength(ssmlOutput) > MAX_SSML_BYTES) {
        logger.warn('SSML output too large, chunking...');
        return chunkTextToSSML(text, MAX_SSML_BYTES);
      }
    }

    // If size is still too large, chunk and return array
    if (byteLength(ssmlOutput) > MAX_SSML_BYTES) {
      logger.warn('Final SSML output still exceeds byte limit, chunking...');
      return chunkTextToSSML(text, MAX_SSML_BYTES);
    }

    return [ssmlOutput];
  } catch (error) {
    logger.error('Dynamic SSML generation failed', { error });
    // Fallback: use our own chunker
    return chunkTextToSSML(text, MAX_SSML_BYTES);
  }
}

export default {
  generateDynamicSSML
};
