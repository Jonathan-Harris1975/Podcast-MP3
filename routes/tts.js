// Simple TTS API Request Examples - Session ID Only

// Example 1: Basic request with just sessionId
const basicRequest = {
  method: 'POST',
  url: 'https://tts-maker.onrender.com/tts/chunked',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    "sessionId": "TT-2025-08-15"
  })
};

// Example 2: Request with custom voice settings
const customVoiceRequest = {
  method: 'POST',
  url: 'https://tts-maker.onrender.com/tts/chunked',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    "sessionId": "TT-2025-08-15",
    "voice": {
      "languageCode": "en-GB",
      "name": "en-GB-Wavenet-B"
    },
    "audioConfig": {
      "audioEncoding": "MP3",
      "speakingRate": 1.2,
      "pitch": 0.0
    }
  })
};

// Example 3: Request with base64 output
const base64Request = {
  method: 'POST',
  url: 'https://tts-maker.onrender.com/tts/chunked',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    "sessionId": "TT-2025-08-15",
    "returnBase64": true
  })
};

// Example 4: Request with custom concurrency
const concurrencyRequest = {
  method: 'POST',
  url: 'https://tts-maker.onrender.com/tts/chunked',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    "sessionId": "TT-2025-08-15",
    "concurrency": 5,
    "audioConfig": {
      "audioEncoding": "MP3",
      "speakingRate": 1.0
    }
  })
};

// Curl examples
const curlBasic = `
curl -X POST https://tts-maker.onrender.com/tts/chunked \\
  -H "Content-Type: application/json" \\
  -d '{"sessionId": "TT-2025-08-15"}'
`;

const curlWithOptions = `
curl -X POST https://tts-maker.onrender.com/tts/chunked \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "TT-2025-08-15",
    "voice": {
      "languageCode": "en-GB",
      "name": "en-GB-Wavenet-B"
    },
    "audioConfig": {
      "audioEncoding": "MP3",
      "speakingRate": 1.0
    },
    "concurrency": 3
  }'
`;

// JavaScript fetch example
async function processTTSSession(sessionId) {
  try {
    const response = await fetch('https://tts-maker.onrender.com/tts/chunked', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: sessionId,
        voice: {
          languageCode: "en-US",
          name: "en-US-Wavenet-D"
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: 1.0
        },
        concurrency: 3
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`HTTP ${response.status}: ${error.error}`);
    }

    const result = await response.json();
    console.log(`Processed ${result.count} audio chunks for session ${sessionId}`);
    return result;
    
  } catch (error) {
    console.error('TTS Processing failed:', error.message);
    throw error;
  }
}

// Usage examples
processTTSSession("TT-2025-08-15");
processTTSSession("TT-2025-08-16");

// Expected response format:
const expectedResponse = {
  "sessionId": "TT-2025-08-15",
  "count": 63,
  "chunks": [
    {
      "index": 0,
      "sourceUrl": "https://pub-7a098297d4ef4011a01077c72929753c.r2.dev/TT-2025-08-15/chunk-1.txt",
      "bytesApprox": 12345,
      "url": "https://pub-f5923355782641348fc97d1a8aa9cd71.r2.dev/TT-2025-08-15-000.mp3"
    },
    {
      "index": 1,
      "sourceUrl": "https://pub-7a098297d4ef4011a01077c72929753c.r2.dev/TT-2025-08-15/chunk-2.txt",
      "bytesApprox": 11234,
      "url": "https://pub-f5923355782641348fc97d1a8aa9cd71.r2.dev/TT-2025-08-15-001.mp3"
    }
    // ... more chunks
  ],
  "summaryBytesApprox": 780456,
  "timestamp": "2025-08-16T13:30:00.000Z"
};
