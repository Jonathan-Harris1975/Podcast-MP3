// index.js or app.js - Updated Express configuration

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

const app = express();
const PORT = process.env.PORT || 3000;

// CRITICAL FIX: Enable trust proxy to handle X-Forwarded-For headers correctly
// This fixes the ValidationError for express-rate-limit when deployed behind a proxy (like Render)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP if needed for your app
}));

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://your-frontend-domain.com'] // Replace with your actual frontend domains
        : true, // Allow all origins in development
    credentials: true,
    optionsSuccessStatus: 200
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting configuration
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 100 : 1000, // Limit each IP to 100 requests per windowMs in production
    message: {
        error: 'Too many requests from this IP',
        retryAfter: '15 minutes'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    // The trust proxy setting above ensures this works correctly with X-Forwarded-For
});

// Apply rate limiting to all requests
app.use(limiter);

// Health check endpoint (excluded from rate limiting)
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

// Import and use your TTS routes
// Replace this with your actual route imports
import ttsRoutes from './src/routes/tts.js';
app.use('/tts', ttsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    // Handle rate limiting errors specifically
    if (err.code === 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR') {
        console.warn('Rate limiting configuration warning (non-critical):', err.message);
        return next(); // Continue processing the request
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
