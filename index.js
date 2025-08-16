// index.js - Production-ready TTS Chunker Service
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// Import TTS routes with CORRECT path
import ttsRoutes from './routes/tts.js';

const app = express();
const PORT = process.env.PORT || process.env.LPORT || 3000;

// CRITICAL: Enable trust proxy for Render deployment
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// CORS configuration for production
app.use(cors({
    origin: process.env.NODE_ENV === 'Production' 
        ? [
            'https://your-frontend-domain.com',
            /\.onrender\.com$/,
            /localhost/
          ] 
        : true,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware with increased limits for audio processing
app.use(express.json({ 
    limit: '50mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ 
    extended: true, 
    limit: '50mb' 
}));

// Rate limiting configuration
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'Production' ? 100 : 1000,
    message: {
        error: 'Too many requests from this IP',
        retryAfter: '15 minutes',
        timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health' || req.path === '/';
    }
});

// Apply rate limiting
app.use(limiter);

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
        
        console.log(JSON.stringify({
            level: logLevel,
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
        }));
    });
    
    next();
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        service: 'TTS Chunker Service',
        version: '3.0.6',
        status: 'operational',
        endpoints: {
            health: '/health',
            ttsChunked: '/tts/chunked',
            ttsStatus: '/tts/status'
        },
        environment: process.env.NODE_ENV,
        features: {
            ssml: process.env.SSML_ENABLED === 'true',
            maxChunkBytes: parseInt(process.env.MAX_SSML_CHUNK_BYTES) || 3400,
            r2Storage: !!process.env.R2_ACCESS_KEY_ID,
            googleTTS: !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.GOOGLE_CREDENTIALS
        },
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    const healthStatus = {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        node_version: process.version,
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            external: Math.round(process.memoryUsage().external / 1024 / 1024)
        },
        features: {
            tts: true,
            ssml: process.env.SSML_ENABLED === 'true',
            r2Storage: {
                configured: !!process.env.R2_ACCESS_KEY_ID,
                buckets: {
                    chunks: process.env.R2_BUCKET_CHUNKS || 'not-configured',
                    merged: process.env.R2_BUCKET_CHUNKS_MERGED || 'not-configured',
                    podcast: process.env.R2_BUCKET_PODCAST || 'not-configured'
                }
            },
            googleTTS: {
                configured: !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS),
                method: process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'credentials-file' : 
                        process.env.GOOGLE_CREDENTIALS ? 'inline-json' : 'none'
            }
        },
        limits: {
            maxChunkBytes: parseInt(process.env.MAX_SSML_CHUNK_BYTES) || 3400,
            minIntroDuration: parseInt(process.env.MIN_INTRO_DURATION) || 16,
            minOutroDuration: parseInt(process.env.MIN_OUTRO_DURATION) || 15
        }
    };

    res.json(healthStatus);
});

// Mount TTS routes
app.use('/tts', ttsRoutes);

// Global error handling middleware
app.use((err, req, res, next) => {
    // Log the error
    console.error(JSON.stringify({
        level: 'error',
        message: err.message,
        stack: process.env.NODE_ENV === 'Production' ? undefined : err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        timestamp: new Date().toISOString()
    }));
    
    // Handle specific error types
    if (err.code === 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR') {
        console.warn('Rate limiting configuration warning (non-critical):', err.message);
        return next();
    }
    
    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            error: 'Request entity too large',
            maxSize: '50MB',
            timestamp: new Date().toISOString()
        });
    }
    
    // Generic error response
    const statusCode = err.status || err.statusCode || 500;
    const errorResponse = {
        error: process.env.NODE_ENV === 'Production' 
            ? 'Internal server error' 
            : err.message,
        timestamp: new Date().toISOString()
    };
    
    if (process.env.NODE_ENV !== 'Production') {
        errorResponse.stack = err.stack;
    }
    
    res.status(statusCode).json(errorResponse);
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: {
            root: '/',
            health: '/health',
            ttsChunked: '/tts/chunked',
            ttsStatus: '/tts/status'
        },
        requestedPath: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log(JSON.stringify({
        level: 'info',
        message: 'SIGTERM received, shutting down gracefully',
        timestamp: new Date().toISOString()
    }));
    
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log(JSON.stringify({
        level: 'info',
        message: 'SIGINT received, shutting down gracefully',
        timestamp: new Date().toISOString()
    }));
    
    process.exit(0);
});

// Start the server
app.listen(PORT, () => {
    console.log(JSON.stringify({
        level: 'info',
        message: `TTS Service running on port ${PORT}`,
        environment: process.env.NODE_ENV || 'development',
        features: {
            tts: true,
            ssml: process.env.SSML_ENABLED === 'true',
            r2: !!process.env.R2_ACCESS_KEY_ID,
            podcast: true
        },
        config: {
            maxChunkBytes: parseInt(process.env.MAX_SSML_CHUNK_BYTES) || 3400,
            trustProxy: true,
            cors: true,
            rateLimit: true
        },
        timestamp: new Date().toISOString()
    }));
});

export default app;
