const express = require('express');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const winston = require('winston');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Configure logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
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
    throw new Error('R2 credentials missing');
  }
} catch (error) {
  console.error('Failed to initialize R2:', error.message);
  process.exit(1);
}

// Get text content from R2 text file
async function getTextFromR2(bucket, key) {
  logger.info('Fetching text file from R2', { bucket, key });
  
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3Client.send(command);
    const textContent = await response.Body.transformToString();
    
    logger.info('Text file retrieved', { 
      key, 
      length: textContent.length 
    });
    
    return textContent.trim();
  } catch (error) {
    logger.error('Failed to fetch text file', { 
      bucket, 
      key, 
      error: error.message 
    });
    throw new Error(`Failed to fetch text file ${key}: ${error.message}`);
  }
}

// List text files for a session
async function listTextFiles(sessionId) {
  const bucket = process.env.R2_BUCKET_CHUNKS_T || 'raw-text';
  const prefix = `${sessionId}/`;
  
  logger.info('Listing text files', { bucket, prefix });
  
  try {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix
    });
    
    const response = await s3Client.send(command);
    const textFiles = (response.Contents || [])
      .filter(obj => obj.Key.endsWith('.txt'))
      .sort((a, b) => a.Key.localeCompare(b.Key));
    
    logger.info('Found text files', { 
      sessionId, 
      count: textFiles.length,
      files: textFiles.map(f => f.Key)
    });
    
    return textFiles;
  } catch (error) {
    logger.error('Failed to list text files', { 
      sessionId, 
      error: error.message 
    });
    throw new Error(`Failed to list text files for ${sessionId}: ${error.message}`);
  }
}

// Convert text to speech using Google TTS
async function synthesizeSpeech(text, voice, audioConfig) {
  logger.info('Starting TTS synthesis', { 
    textLength: text.length,
    voice: voice?.name || 'default',
    textPreview: text.substring(0, 100) + '...'
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
    logger.info('Calling Google TTS API...');
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
      code: error.code,
      details: error.details
    });
    throw new Error(`TTS failed: ${error.message}`);
  }
}

// Upload audio to R2 chunks bucket
async function uploadAudioToR2(audioBuffer, filename) {
  const bucket = process.env.R2_BUCKET_CHUNKS || 'podcast-chunks';
  const baseUrl = process.env.R2_PUBLIC_BASE_URL_CHUNKS;

  logger.info('Uploading audio to R2', { 
    bucket,
    filename, 
    size: audioBuffer.length
  });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: filename,
    Body: audioBuffer,
    ContentType: 'audio/mpeg',
    ContentLength: audioBuffer.length
  });

  try {
    await s3Client.send(command);
    const url = `${baseUrl}/${filename}`;
    logger.info('Audio upload successful', { url });
    return url;
  } catch (error) {
    logger.error('R2 upload failed', { 
      bucket,
      filename,
      error: error.message 
    });
    throw new Error(`Upload failed: ${error.message}`);
  }
}

// Process text file to audio
async function processTextFileToAudio(textFile, index, voice, audioConfig, sessionId) {
  try {
    const textBucket = process.env.R2_BUCKET_CHUNKS_T || 'raw-text';
    
    logger.info('Processing text file to audio', { 
      index,
      sessionId,
      textFile: textFile.Key
    });

    // 1. Get text content from the text file
    const textContent = await getTextFromR2(textBucket, textFile.Key);
    
    if (!textContent || textContent.length === 0) {
      throw new Error(`Text file ${textFile.Key} is empty`);
    }

    // 2. Convert text to speech
    const audioBuffer = await synthesizeSpeech(textContent, voice, audioConfig);

    // 3. Create audio filename (replace .txt with .mp3)
    const audioFilename = textFile.Key.replace('.txt', '.mp3').replace(`${sessionId}/`, `${sessionId}/audio-`);

    // 4. Upload audio to chunks bucket
    const audioUrl = await uploadAudioToR2(audioBuffer, audioFilename);

    return {
      index,
      originalTextFile: textFile.Key,
      audioFile: audioFilename,
      url: audioUrl,
      bytesApprox: audioBuffer.length,
      textLength: textContent.length
    };

  } catch (error) {
    logger.error('Failed to process text file', { 
      index,
      sessionId,
      textFile: textFile.Key,
      error: error.message 
    });
    throw error;
  }
}

// Main endpoint - Process existing text files to audio
app.post('/chunked', async (req, res) => {
  try {
    const {
      sessionId // Only sessionId is required - everything else uses defaults
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({ 
        error: 'sessionId is required - this should match the folder name in raw-text bucket' 
      });
    }

    // Use default voice and audio config since files are already set up
    const voice = {
      languageCode: 'en-US',
      name: 'en-US-Wavenet-D'
    };

    const audioConfig = {
      audioEncoding: 'MP3',
      speakingRate: 1.0
    };

    const concurrency = 3;

    logger.info('Processing TTS request for existing text files', { sessionId });

    // 1. List all text files for this session
    const textFiles = await listTextFiles(sessionId);
    
    if (textFiles.length === 0) {
      return res.status(404).json({ 
        error: `No text files found for session ${sessionId}`,
        hint: 'Make sure text files exist in the raw-text bucket under this session ID'
      });
    }

    logger.info('Found text files to process', { 
      sessionId,
      fileCount: textFiles.length 
    });

    // 2. Process text files to audio with concurrency control
    const results = [];
    for (let i = 0; i < textFiles.length; i += concurrency) {
      const batch = textFiles.slice(i, i + concurrency);
      const batchPromises = batch.map((textFile, batchIndex) => {
        const index = i + batchIndex;
        return processTextFileToAudio(textFile, index, voice, audioConfig, sessionId);
      });

      logger.info('Processing batch of text files', { 
        sessionId, 
        batchStart: i, 
        batchSize: batch.length 
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      // Check for failures
      const failed = batchResults.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        logger.error('Batch processing failed', { 
          sessionId, 
          failedCount: failed.length,
          errors: failed.map(f => f.reason.message)
        });
        throw new Error(`Failed to process ${failed.length} text files: ${failed[0].reason.message}`);
      }

      results.push(...batchResults.map(r => r.value));
    }

    const totalBytes = results.reduce((sum, r) => sum + r.bytesApprox, 0);
    const totalTextLength = results.reduce((sum, r) => sum + r.textLength, 0);

    logger.info('TTS processing complete', { 
      sessionId, 
      processedCount: results.length,
      totalAudioBytes: totalBytes,
      totalTextLength: totalTextLength,
      avgAudioSize: Math.round(totalBytes / results.length)
    });

    // Return the audio URLs
    res.json({
      sessionId,
      count: results.length,
      chunks: results.map(r => ({
        index: r.index,
        url: r.url,
        bytesApprox: r.bytesApprox,
        originalTextFile: r.originalTextFile,
        audioFile: r.audioFile
      })),
      summaryBytesApprox: totalBytes,
      totalTextLength: totalTextLength
    });

  } catch (error) {
    logger.error('TTS request failed', { 
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: 'TTS processing failed',
      details: error.message
    });
  }
});

// Health check endpoint to verify text files exist for a session
app.get('/session/:sessionId/files', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const textFiles = await listTextFiles(sessionId);
    
    res.json({
      sessionId,
      textFilesFound: textFiles.length,
      files: textFiles.map(f => ({
        key: f.Key,
        size: f.Size,
        lastModified: f.LastModified
      }))
    });
  } catch (error) {
    res.status(404).json({
      error: `No text files found for session ${req.params.sessionId}`,
      details: error.message
    });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TTS Chunker Service',
    environment: process.env.NODE_ENV || 'development',
    features: {
      tts: !!ttsClient,
      ssml: process.env.SSML_ENABLED === 'true',
      r2: !!s3Client,
      podcast: true
    },
    config: {
      maxChunkBytes: parseInt(process.env.MAX_SSML_CHUNK_BYTES) || 3400,
      trustProxy: true,
      cors: true,
      rateLimit: true
    }
  });
});

const PORT = process.env.LPORT || process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info('TTS Service running', { 
    message: `TTS Service running on port ${PORT}`,
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    features: {
      tts: !!ttsClient,
      ssml: process.env.SSML_ENABLED === 'true',
      r2: !!s3Client,
      podcast: true
    },
    config: {
      maxChunkBytes: parseInt(process.env.MAX_SSML_CHUNK_BYTES) || 3400,
      trustProxy: true,
      cors: true,
      rateLimit: true
    }
  });
});

module.exports = app;
