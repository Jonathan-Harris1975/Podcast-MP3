import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import logger from './logger.js';

let client;

async function initializeClient() {
  try {
    // Try GOOGLE_CREDENTIALS first
    if (process.env.GOOGLE_CREDENTIALS) {
      logger.info('Initializing TTS client with GOOGLE_CREDENTIALS');
      return new TextToSpeechClient({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
        projectId: process.env.GCP_PROJECT_ID
      });
    }
    
    // Fallback to default credentials if no explicit credentials provided
    logger.info('Initializing TTS client with default credentials');
    return new TextToSpeechClient();
    
  } catch (err) {
    logger.error('TTS client initialization failed:', err);
    throw new Error(`TTS initialization failed: ${err.message}`);
  }
}

// Initialize client immediately
client = await initializeClient();

export async function generateTTS(ssml) {
  if (!client) {
    throw new Error('TTS client not initialized');
  }

  try {
    const [response] = await client.synthesizeSpeech({
      input: { ssml },
      voice: {
        languageCode: process.env.TTS_LANGUAGE_CODE || 'en-GB',
        name: process.env.TTS_VOICE_NAME || 'en-GB-Wavenet-B'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: parseFloat(process.env.TTS_SPEAKING_RATE || '1.1'),
        pitch: parseFloat(process.env.TTS_PITCH || '-2.2')
      }
    });
    return response.audioContent;
  } catch (err) {
    logger.error('TTS synthesis failed:', err);
    throw new Error(`TTS failed: ${err.message}`);
  }
}

export default { generateTTS };
