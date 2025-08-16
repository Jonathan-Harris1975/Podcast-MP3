const express = require('express');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Initialize clients
let ttsClient;
let s3Client;

// Initialize Google TTS client
try {
  if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    ttsClient = new TextToSpeechClient({ credentials });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    ttsClient = new TextToSpeechClient();
  } else {
    throw new Error('No Google credentials found');
  }
  console.log('✅ Google TTS client initialized');
} catch (error) {
  console.error('❌ Failed to initialize Google TTS:', error.message);
  process.exit(1);
}

// Initialize R2/S3 client
try {
  if (process.env.R2_ACCESS_KEY_ID) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    console.log('✅ R2 client initialized');
  } else {
    console.warn('⚠️ No R2 credentials found');
  }
} catch (error) {
  console.error('❌ Failed to initialize R2:', error.message);
}

// Split text into SSML-safe chunks
function splitTextIntoChunks(text, maxChunkSize = 4000) {
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
        // Handle very long sentences by splitting on commas
        const subSentences = trimmedSentence.split(',');
        for (const subSentence of subSentences) {
          chunks.push(subSentence.trim() + '.');
        }
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk + '.');
  }

  return chunks.filter(chunk => chunk.trim().length > 0);
}

// Convert text to speech using Google TTS
async function textToSpeech(text, voice, audioConfig) {
  console.log(`🔊 Converting text to speech (${text.length} chars)`);
  
  const request = {
    input: { text: text.trim() },
    voice: voice || {
      languageCode: 'en-US',
      name: 'en-US-Wavenet-D',
    },
    audioConfig: audioConfig || {
      audioEncoding: 'MP3',
      speakingRate: 1.0,
    },
  };

  try {
    console.log('📡 Making TTS API request...');
    const [response] = await ttsClient.synthesizeSpeech(request);
    
    if (!response.audioContent || response.audioContent.length === 0) {
      throw new Error('Empty audio content received from TTS API');
    }
    
    console.log(`✅ TTS success! Audio size: ${response.audioContent.length} bytes`);
    return response.audioContent;
  } catch (error) {
    console.error('❌ TTS API Error:', error.message);
    console.error('Request was:', JSON.stringify(request, null, 2));
    throw new Error(`TTS failed: ${error.message}`);
  }
}

// Upload audio to R2
async function uploadToR2(audioBuffer, bucket, key) {
  if (!s3Client) {
    throw new Error('R2 client not initialized');
  }

  console.log(`📤 Uploading ${key} to R2 (${audioBuffer.length} bytes)`);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: audioBuffer,
    ContentType: 'audio/mpeg',
    ContentLength: audioBuffer.length,
  });

  try {
    await s3Client.send(command);
    const url = `${process.env.R2_PUBLIC_BASE_URL}/${key}`;
    console.log(`✅ Upload successful: ${url}`);
    return url;
  } catch (error) {
    console.error('❌ R2 Upload Error:', error.message);
    throw new Error(`Upload failed: ${error.message}`);
  }
}

// Process single chunk
async function processChunk(chunkText, index, voice, audioConfig, bucket, prefix) {
  try {
    console.log(`\n🔄 Processing chunk ${index}...`);
    
    // Convert text to audio - THIS IS THE CRITICAL STEP
    const audioBuffer = await textToSpeech(chunkText, voice, audioConfig);
    
    // Generate filename
    const filename = `${prefix}-${String(index).padStart(3, '0')}.mp3`;
    
    // Upload audio to R2 - NOT TEXT!
    const url = await uploadToR2(audioBuffer, bucket, filename);
    
    return {
      index,
      bytesApprox: audioBuffer.length,
      url,
      success: true
    };
  } catch (error) {
    console.error(`❌ Failed to process chunk ${index}:`, error.message);
    // DO NOT UPLOAD TEXT AS FALLBACK!
    throw error;
  }
}

// Main endpoint
app.post('/tts/chunked', async (req, res) => {
  console.log('\n🚀 New TTS request received');
  
  try {
    const {
      text,
      voice,
      audioConfig,
      concurrency = 3,
      R2_BUCKET,
      R2_PREFIX,
      returnBase64 = false
    } = req.body;

    // Validation
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required and must be a string' });
    }

    if (!returnBase64 && (!R2_BUCKET || !R2_PREFIX)) {
      return res.status(400).json({ error: 'R2_BUCKET and R2_PREFIX are required when not using base64' });
    }

    console.log(`📝 Input text length: ${text.length} characters`);

    // Split text into chunks
    const chunks = splitTextIntoChunks(text);
    console.log(`✂️ Split into ${chunks.length} chunks`);

    // Process chunks with concurrency control
    const results = [];
    const semaphore = Array(concurrency).fill(null);
    
    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency);
      const promises = batch.map((chunk, batchIndex) => {
        const chunkIndex = i + batchIndex;
        return processChunk(chunk, chunkIndex, voice, audioConfig, R2_BUCKET, R2_PREFIX);
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
    }

    // Calculate total size
    const totalBytes = results.reduce((sum, result) => sum + result.bytesApprox, 0);

    console.log(`✅ All chunks processed successfully! Total: ${totalBytes} bytes`);

    // Return response
    res.json({
      count: results.length,
      chunks: results,
      summaryBytesApprox: totalBytes
    });

  } catch (error) {
    console.error('❌ Request failed:', error.message);
    res.status(500).json({ 
      error: 'TTS processing failed', 
      details: error.message 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    tts: !!ttsClient,
    r2: !!s3Client 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎤 TTS service running on port ${PORT}`);
});

module.exports = app;
