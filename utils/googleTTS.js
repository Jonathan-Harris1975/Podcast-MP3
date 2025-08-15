import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import logger from './logger.js';
import { applyVoiceEnhancements } from './audioEffects.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

  // Use environment variables correctly - remove defaults from audioConfig
  // since SSML already contains prosody settings
  const audioConfig = {
    audioEncoding: 'MP3',
    effectsProfileId: process.env.VOICE_EFFECTS === 'none' ? [] : [process.env.VOICE_EFFECTS || 'studio']
  };

  // Validate SSML format
  if (!ssml.includes('<speak>')) {
    logger.warn('Input appears to be plain text, not SSML', { 
      chunkIndex, 
      sample: ssml.substring(0, 100) 
    });
    throw new Error('Invalid SSML format - missing <speak> wrapper');
  }

  try {
    logger.info('Synthesizing speech', {
      chunkIndex,
      voiceConfig,
      ssmlLength: ssml.length,
      ssmlSample: ssml.substring(0, 150)
    });

    const [response] = await client.synthesizeSpeech({
      input: { ssml },
      voice: voiceConfig,
      audioConfig
    });

    // Handle audio enhancements if enabled
    if (process.env.AUDIO_BASS_BOOST || process.env.AUDIO_NOISE_REDUCTION === 'true') {
      // Create temporary file for audio processing
      const tempFile = join(tmpdir(), `tts_chunk_${chunkIndex}_${Date.now()}.mp3`);
      writeFileSync(tempFile, response.audioContent);
      
      try {
        const enhancedPath = await applyVoiceEnhancements(tempFile);
        const enhancedContent = require('fs').readFileSync(enhancedPath);
        
        // Cleanup temp files
        unlinkSync(tempFile);
        if (enhancedPath !== tempFile) {
          unlinkSync(enhancedPath);
        }
        
        return enhancedContent;
      } catch (enhancementError) {
        logger.warn('Audio enhancement failed, returning original', { 
          chunkIndex, 
          error: enhancementError.message 
        });
        unlinkSync(tempFile);
        return response.audioContent;
      }
    }

    return response.audioContent;
  } catch (error) {
    logger.error('TTS synthesis failed', {
      error: {
        code: error.code,
        details: error.details,
        metadata: error.metadata,
        note: error.note
      },
      voiceConfig,
      chunkIndex,
      ssmlSample: ssml.substring(0, 100)
    });
    throw error;
  }
}
