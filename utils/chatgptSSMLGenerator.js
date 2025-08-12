// utils/chatgptSSMLGenerator.js
import axios from 'axios';
import logger from './logger.js';
import { validateSSML } from './ssmlValidator.js';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GPT_MODEL = process.env.GPT_MODEL || 'gpt-4-1106-preview';
const GPT_TEMPERATURE = parseFloat(process.env.GPT_TEMPERATURE || '0.7');

/**
 * Generates enhanced SSML using ChatGPT with podcast-specific optimizations
 * @param {string} text - Input text to convert to SSML
 * @param {object} options - Generation options
 * @returns {Promise<string>} Enhanced SSML string
 */
export async function generateEnhancedSSML(text, options = {}) {
  const {
    voice = process.env.DEFAULT_VOICE || 'en-GB-Wavenet-B',
    speakingRate = process.env.DEFAULT_SPEAKING_RATE || 1.1,
    pitch = process.env.DEFAULT_PITCH || -2.2,
    strictValidation = true
  } = options;

  const systemPrompt = `You are an expert SSML (Speech Synthesis Markup Language) engineer specializing in high-quality podcast audio production. Your task is to transform raw text into optimally tagged SSML for Google Cloud Text-to-Speech, specifically for voice ${voice}.

Key Guidelines:
1. Structure for ${voice} with ${speakingRate}x speed and ${pitch} pitch baseline
2. Use UK English formatting (day-month-year, GBP currency)
3. Apply natural pauses between paragraphs (500-700ms) and sentences (300ms)
4. Add moderate emphasis to key terms and proper nouns
5. Format all dates, numbers, acronyms with <say-as> tags
6. Include subtle prosody variations for vocal variety
7. Keep SSML valid and compatible with Google TTS
8. Maximum SSML length: ${process.env.MAX_TEXT_LENGTH || 5000} characters

Special Requirements:
- UK date format (DD/MM/YYYY)
- Telephone numbers in +44 format
- Technical terms spelled out (e.g., "API" as "A P I")
- Longer pauses (${process.env.SSML_BREAK_MS || 360}ms) for UK speech patterns`;

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

    const ssml = response.data.choices[0]?.message?.content;
    if (!ssml) throw new Error('No SSML returned from ChatGPT');

    // Validate with our existing validator
    const validation = validateSSML(ssml, strictValidation);
    if (!validation.isValid) {
      logger.warn('SSML validation warnings', validation.warnings);
    }

    return ssml;
  } catch (error) {
    logger.error('ChatGPT SSML generation failed', error);
    // Fallback to our existing SSML generator
    const { makeUKSSML } = await import('./ssmlTools.js');
    return makeUKSSML(text);
  }
}
