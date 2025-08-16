const express = require('express');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const winston = require('winston');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Initialize Google TTS client
let ttsClient;
try {
  if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    ttsClient = new TextToSpeechClient({ credentials });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    ttsClient = new TextToSpeechClient();
  } else {
    throw new Error('No Google credentials found');
  }
  console.log('Google TTS client initialized successfully');
} catch (error) {
  console.error('Failed to initialize Google TTS:', error.message);
  process.exit(1);
}

// Initialize R2 client
let s3Client;
try {
  if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_ENDPOINT) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    console.log('R2 client initialized successfully');
  } else {
    console.warn('R2 credentials missing - will return base64 instead');
  }
} catch (error) {
  console.error('Failed to initialize R2:', error.message);
}

// Split text into chunks
function splitTextIntoChunks(text, maxChunkSize = 3400) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;

    const potentialChunk = currentChunk + (currentChunk ? '. ' : '') + trimmedSentence;
    
    if (potentialChunk.length <= maxChunkSize) {
      currentChunk = potentialChunk;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk + '.');
        currentChunk = trimmedSentence;
      } else {
        chunks.push(trimmedSentence + '.');
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk + '.');
  }

  return chunks.filter(chunk => chunk.trim().length > 0);
}

// Convert text to speech
async function synthesizeSpeech(text, voice, audioConfig) {
  logger.info('Starting TTS synthesis', { 
    textLength: text.length,
    voice: voice?.name || 'default'
  });

  const request = {
    input: { text: text.trim() },
    voice: voice || {
      languageCode: 'en-US',
      name: 'en-US-Wavenet-D'
    },
    audioConfig: audioConfig || {
      audioEncoding: 'MP3',
      speakingRate: 1.0
    }
  };

  try {
    const [response] = await ttsClient.synthesizeSpeech(request);
    
    if (!response.audioContent || response.audioContent.length === 0) {
      throw new Error('Empty audio content received from TTS API');
    }

    logger.info('TTS synthesis successful', { 
      audioSize: response.audioContent.length 
    });
    
    return response.audioContent;
  } catch (error) {
    logger.error('TTS synthesis failed', { 
      error: error.message,
      code: error.code 
    });
    throw new Error(`TTS failed: ${error.message}`);
  }
}

// Upload to R2
async function uploadToR2(audioBuffer, key, bucket) {
  if (!s3Client) {
    throw new Error('R2 client not available');
  }

  logger.info('Uploading to R2', { 
    key, 
    size: audioBuffer.length 
  });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: audioBuffer,
    ContentType: 'audio/mpeg',
    ContentLength: audioBuffer.length
  });

  try {
    await s3Client.send(command);
    const url = `${process.env.R2_PUBLIC_BASE_URL}/${key}`;
    logger.info('R2 upload successful', { url });
    return url;
  } catch (error) {
    logger.error('R2 upload failed', { error: error.message });
    throw new Error(`Upload failed: ${error.message}`);
  }
}

// Process single chunk
async function processChunk(text, index, voice, audioConfig, sessionId, returnBase64 = false) {
  try {
    logger.info('Processing chunk', { index, sessionId });

    // *** THIS IS THE CRITICAL PART - ACTUALLY CALL TTS ***
    const audioBuffer = await synthesizeSpeech(text, voice, audioConfig);

    if (returnBase64 || !s3Client) {
      // Return base64 if no R2 or requested
      return {
        index,
        base64: audioBuffer.toString('base64'),
        bytesApprox: audioBuffer.length
      };
    } else {
      // Upload to R2 and return URL
      const filename = `${sessionId}/chunk-${index + 1}.mp3`; // .MP3 NOT .TXT!
      const url = await uploadToR2(audioBuffer, filename, process.env.R2_BUCKET || 'default-bucket');
      
      return {
        index,
        url,
        bytesApprox: audioBuffer.length
      };
    }
  } catch (error) {
    logger.error('Chunk processing failed', { 
      index, 
      sessionId, 
      error: error.message 
    });
    throw error;
  }
}

// Main TTS endpoint - FIXED VERSION
app.post('/chunked', async (req, res) => {
  const sessionId = `TT-${new Date().toISOString().split('T')[0]}-${Date.now()}`;
  
  logger.info('Processing TTS request', { sessionId });

  try {
    const {
      text,
      voice,
      audioConfig,
      returnBase64 = false
    } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Split text into chunks
    const chunks = splitTextIntoChunks(text);
    logger.info('Text split into chunks', { 
      sessionId, 
      chunkCount: chunks.length,
      totalLength: text.length 
    });

    // Process all chunks - ACTUALLY DO TTS PROCESSING
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      const result = await processChunk(
        chunks[i], 
        i, 
        voice, 
        audioConfig, 
        sessionId, 
        returnBase64
      );
      results.push(result);
    }

    const totalBytes = results.reduce((sum, r) => sum + r.bytesApprox, 0);

    logger.info('TTS processing complete', { 
      sessionId, 
      chunkCount: results.length,
      totalBytes 
    });

    // Return the results
    res.json({
      sessionId,
      count: results.length,
      chunks: results,
      summaryBytesApprox: totalBytes
    });

  } catch (error) {
    logger.error('TTS request failed', { 
      sessionId, 
      error: error.message 
    });
    
    res.status(500).json({
      error: 'TTS processing failed',
      details: error.message,
      sessionId
    });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TTS Chunker',
    features: {
      tts: !!ttsClient,
      r2: !!s3Client
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info('TTS Service running', { 
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    features: {
      tts: !!ttsClient,
      r2: !!s3Client
    }
  });
});

module.exports = app;
