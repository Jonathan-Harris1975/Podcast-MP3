import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import logger from './utils/logger.js';
import { processURLsToMergedTTS } from './utils/ttsProcessor.js';

const app = express();
const PORT = process.env.PORT || 3000;

// JSON middleware with strict validation of incoming JSON format
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      logger.error('Invalid JSON received:', {
        url: req.originalUrl,
        headers: req.headers,
        body: buf.toString()
      });
      throw new Error('Invalid JSON format');
    }
  }
}));

// Security and CORS middleware
app.use(helmet());
app.use(cors());

// Rate limiting middleware (100 requests per 15 minutes per IP)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Main TTS processing endpoint
app.post('/api/process', async (req, res) => {
  try {
    const { sessionId, urls } = req.body;

    // Validate presence of required fields
    if (!sessionId || !urls) {
      return res.status(400).json({
        error: 'Invalid request format',
        message: 'Payload must be: {"sessionId":"TT-YYYY-MM-DD","urls":"url"} or {"sessionId":"TT-YYYY-MM-DD","urls":["url1","url2"]}',
        exampleValidPayloads: [
          {
            sessionId: "TT-2025-08-11",
            urls: "https://pub-7a098297d4ef4011a01077c72929753c.r2.dev/raw-text/TT-2025-08-11/chunk-1.txt"
          },
          {
            sessionId: "TT-2025-08-11",
            urls: [
              "https://pub-7a098297d4ef4011a01077c72929753c.r2.dev/raw-text/TT-2025-08-11/chunk-1.txt",
              "https://pub-7a098297d4ef4011a01077c72929753c.r2.dev/raw-text/TT-2025-08-11/chunk-2.txt"
            ]
          }
        ]
      });
    }

    // Call TTS processor
    const result = await processURLsToMergedTTS(urls, sessionId);
    res.json(result);
  } catch (error) {
    logger.error(`Processing error: ${error.message}`);
    res.status(500).json({
      error: 'Processing failed',
      details: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
