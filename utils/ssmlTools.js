export function chunkTextToSSML(text, maxBytes = 3900, overlap = 50) {
  if (!text?.trim()) return [];
  const segments = [];
  let currentChunk = '';

  // Split into sentences for safe chunking
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  for (const sentence of sentences) {
    let testChunk = (currentChunk + sentence).trim();
    // Wrap each chunk as a full SSML doc for test
    let ssmlTest = `<speak><prosody rate="${process.env.DEFAULT_SPEAKING_RATE || 1.25}" pitch="${process.env.DEFAULT_PITCH || '-2.0'}st" volume="${process.env.DEFAULT_VOLUME || '+1.5dB'}">${testChunk}</prosody></speak>`;
    if (Buffer.byteLength(ssmlTest, 'utf8') > maxBytes) {
      if (currentChunk.trim().length > 0) {
        // Only push if it's non-empty
        segments.push(`<speak><prosody rate="${process.env.DEFAULT_SPEAKING_RATE || 1.25}" pitch="${process.env.DEFAULT_PITCH || '-2.0'}st" volume="${process.env.DEFAULT_VOLUME || '+1.5dB'}">${currentChunk.trim()}</prosody></speak>`);
        currentChunk = sentence;
      } else {
        // Sentence itself is too big, split by words
        let words = sentence.split(' ');
        let subChunk = '';
        for (let word of words) {
          let testSub = (subChunk + word).trim();
          let ssmlSubTest = `<speak><prosody rate="${process.env.DEFAULT_SPEAKING_RATE || 1.25}" pitch="${process.env.DEFAULT_PITCH || '-2.0'}st" volume="${process.env.DEFAULT_VOLUME || '+1.5dB'}">${testSub}</prosody></speak>`;
          if (Buffer.byteLength(ssmlSubTest, 'utf8') > maxBytes) {
            if (subChunk.trim().length > 0) {
              segments.push(`<speak><prosody rate="${process.env.DEFAULT_SPEAKING_RATE || 1.25}" pitch="${process.env.DEFAULT_PITCH || '-2.0'}st" volume="${process.env.DEFAULT_VOLUME || '+1.5dB'}">${subChunk.trim()}</prosody></speak>`);
              subChunk = word;
            } else {
              subChunk = word;
            }
          } else {
            subChunk += ' ' + word;
          }
        }
        if (subChunk.trim().length > 0) {
          segments.push(`<speak><prosody rate="${process.env.DEFAULT_SPEAKING_RATE || 1.25}" pitch="${process.env.DEFAULT_PITCH || '-2.0'}st" volume="${process.env.DEFAULT_VOLUME || '+1.5dB'}">${subChunk.trim()}</prosody></speak>`);
        }
        currentChunk = '';
      }
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk.trim().length > 0) {
    segments.push(`<speak><prosody rate="${process.env.DEFAULT_SPEAKING_RATE || 1.25}" pitch="${process.env.DEFAULT_PITCH || '-2.0'}st" volume="${process.env.DEFAULT_VOLUME || '+1.5dB'}">${currentChunk.trim()}</prosody></speak>`);
  }
  return segments;
}
