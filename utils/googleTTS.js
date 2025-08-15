import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import logger from './logger.js';
import { applyVoiceEnhancements } from './audioEffects.js';

const client = new TextToSpeechClient({
  credentials: process.env.GOOGLE_CREDENTIALS ? JSON.parse(process.env.GOOGLE_CREDENTIALS) : undefined,
  projectId: process.env.GCP_PROJECT_ID,
  apiEndpoint: `${process.env.GCP_LOCATION || 'europe-west2'}-texttospeech.googleapis.com`
});

export async function generateTTS(ssml, chunkIndex = 0) {
  const voiceConfig = {
    languageCode: 'en-GB',
    name: process.env.DEFAULT_VOICE || 'en-GB-Wavenet-D',
    ssmlGender: 'MALE'
  };

  const audioConfig = {
    audioEncoding: 'MP3',
    speakingRate: parseFloat(process.env.DEFAULT_SPEAKING_RATE || 1.25),
    pitch: parseFloat(process.env.DEFAULT_PITCH || -2.0),
    volumeGainDb: parseFloat(process.env.DEFAULT_VOLUME || 1.5),
    effectsProfileId: [process.env.VOICE_EFFECTS || 'studio']
  };

  try {
    const [response] = await client.synthesizeSpeech({
      input: { ssml },
      voice: voiceConfig,
      audioConfig
    });

    return await applyVoiceEnhancements(response.audioContent, chunkIndex);
  } catch (error) {
    logger.error('TTS synthesis failed', {
      error,
      voiceConfig,
      chunkIndex,
      ssmlSample: ssml.substring(0, 100)
    });
    // Do not retry here; let upstream code re-chunk and retry if needed
    throw error;
  }
}
