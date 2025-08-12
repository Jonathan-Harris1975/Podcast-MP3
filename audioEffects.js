import { exec } from 'child_process';
import { promisify } from 'util';
const execPromise = promisify(exec);

export async function applyVoiceEnhancements(inputPath) {
  const effects = [];
  
  if (process.env.AUDIO_BASS_BOOST) {
    effects.push(`bass=g=${process.env.AUDIO_BASS_BOOST}:f=125:w=0.5`);
  }

  if (process.env.AUDIO_NOISE_REDUCTION === 'true') {
    effects.push('arnndn=model=default');
  }

  if (effects.length > 0) {
    await execPromise(
      `ffmpeg -y -i "${inputPath}" -af "${effects.join(',')}" "${inputPath}_enhanced.mp3"`
    );
    return `${inputPath}_enhanced.mp3`;
  }

  return inputPath;
}
