// index.js - Corrected import paths

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// CORRECTED: Import TTS routes with proper relative path
import ttsRoutes from './routes/tts.js';

const app = express();
const PORT = process.env.PORT || 3000;

// CRITICAL FIX: Enable trust proxy to handle X-Forwarded-For headers correctly
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
}));

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://your-frontend-domain.com']
        : true,
    credentials: true,
    optionsSuccessStatus: 200
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting configuration
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 100 : 1000,
    message: {
        error: 'Too many requests from this IP',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply rate limiting to all requests
app.use(limiter);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        features: {
            tts: true,
            r2: !!process.env.R2_ACCESS_KEY_ID,
            podcast: true
        }
    });
});

// Use TTS routes
app.use('/tts', ttsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    if (err.code === 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR') {
        console.warn('Rate limiting configuration warning (non-critical):', err.message);
        return next();
    }
    
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message,
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: ['/health', '/tts/chunked'],
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(JSON.stringify({
        level: 'info',
        message: `TTS Service running on port ${PORT}`,
        environment: process.env.NODE_ENV || 'development',
        features: {
            tts: true,
            r2: !!process.env.R2_ACCESS_KEY_ID,
            podcast: true
        }
    }));
});

export default app;
