import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import ttsRouter from "./routes/tts.js";

const app = express();
const PORT = process.env.PORT || 5000;

// CRITICAL: Configure CORS with timeout considerations
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [/\.render\.com$/, /localhost/] 
    : true,
  credentials: true,
  optionsSuccessStatus: 200
}));

// CRITICAL: Increase payload limits for large text processing
app.use(bodyParser.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    // Log payload size for monitoring
    if (buf.length > 10000000) { // 10MB
      console.warn(`⚠️ Large payload received: ${(buf.length / 1024 / 1024).toFixed(2)}MB`);
    }
  }
}));
app.use(bodyParser.urlencoded({ 
  limit: '50mb', 
  extended: true,
  parameterLimit: 50000
}));

// CRITICAL: Request timeout middleware - MUST be before routes
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Set timeouts before Render's 10-minute hard limit
  const TIMEOUT_MS = 580000; // 9 minutes 40 seconds
  req.setTimeout(TIMEOUT_MS);
  res.setTimeout(TIMEOUT_MS);
  
  // Handle request timeout
  req.on('timeout', () => {
    const elapsed = Date.now() - startTime;
    console.error(`🕐 Request timeout after ${elapsed}ms: ${req.method} ${req.url}`);
    
    if (!res.headersSent) {
      res.status(408).json({ 
        error: 'Request timeout',
        message: `Request exceeded ${TIMEOUT_MS/1000} second limit`,
        elapsedMs: elapsed
      });
    }
  });
  
  // Handle response timeout
  res.on('timeout', () => {
    const elapsed = Date.now() - startTime;
    console.error(`🕐 Response timeout after ${elapsed}ms: ${req.method} ${req.url}`);
  });
  
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  console.log(`📥 ${req.method} ${req.url} - Started at ${timestamp}`);
  
  // Log request body size for TTS endpoints
  if (req.body && (req.url.includes('tts') || req.url.includes('chunked'))) {
    const bodySize = JSON.stringify(req.body).length;
    console.log(`📊 Request body size: ${(bodySize / 1024).toFixed(2)}KB`);
    
    if (req.body.text) {
      console.log(`📝 Text length: ${req.body.text.length} characters`);
    }
  }
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;
    const statusIcon = status < 400 ? '✅' : status < 500 ? '⚠️' : '❌';
    
    console.log(`${statusIcon} ${req.method} ${req.url} - ${status} - ${duration}ms`);
    
    // Warn on slow requests
    if (duration > 60000) { // 1 minute
      console.warn(`🐌 Slow request detected: ${duration}ms for ${req.method} ${req.url}`);
    }
  });
  
  res.on('error', (err) => {
    console.error(`❌ Response error for ${req.method} ${req.url}:`, err);
  });
  
  next();
});

// Memory monitoring middleware
app.use((req, res, next) => {
  // Monitor memory usage for TTS requests
  if (req.url.includes('tts')) {
    const memBefore = process.memoryUsage();
    
    res.on('finish', () => {
      const memAfter = process.memoryUsage();
      const heapUsedDiff = memAfter.heapUsed - memBefore.heapUsed;
      
      if (heapUsedDiff > 100 * 1024 * 1024) { // 100MB increase
        console.warn(`🧠 High memory usage: +${(heapUsedDiff / 1024 / 1024).toFixed(2)}MB`);
        console.warn(`💾 Current heap: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        
        // Suggest garbage collection for large memory increases
        if (global.gc && heapUsedDiff > 200 * 1024 * 1024) {
          global.gc();
          console.log(`🗑️ Garbage collection triggered`);
        }
      }
    });
  }
  
  next();
});

// Routes
app.use("/api/tts", ttsRouter);

// Enhanced health check endpoint
app.get("/", (req, res) => {
  const uptime = Math.floor(process.uptime());
  const memoryUsage = process.memoryUsage();
  
  res.json({
    status: "Podcast TTS API is running 🚀",
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: uptime,
      human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`
    },
    memory: {
      heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
      heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
      rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB`
    },
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    pid: process.pid
  });
});

// Detailed health check for monitoring
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    loadAverage: process.loadavg ? process.loadavg() : null
  });
});

// CRITICAL: Proper server setup with comprehensive timeout configuration
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📡 Bind address: 0.0.0.0:${PORT}`);
  console.log(`🧠 Node version: ${process.version}`);
  console.log(`💾 Initial memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`);
  
  // Log critical configurations
  console.log(`⏰ Request timeout: 9m 40s (580000ms)`);
  console.log(`📦 Payload limit: 50MB`);
  console.log(`🔒 CORS enabled for: ${process.env.NODE_ENV === 'production' ? 'render.com domains' : 'all origins'}`);
});

// ESSENTIAL: Configure server-level timeouts
server.keepAliveTimeout = 120000; // 2 minutes - longer than typical load balancer timeout
server.headersTimeout = 125000;   // 2 minutes 5 seconds - slightly longer than keepAlive

// Additional server configurations for production
server.maxConnections = 1000; // Limit concurrent connections
server.timeout = 600000;      // 10 minutes - matches Render's limit

// Comprehensive error handling
server.on('error', (err) => {
  console.error('❌ Server error:', err);
  
  // Log specific error types
  if (err.code === 'EADDRINUSE') {
    console.error(`🚫 Port ${PORT} is already in use`);
  } else if (err.code === 'EACCES') {
    console.error(`🚫 Permission denied for port ${PORT}`);
  }
});

server.on('clientError', (err, socket) => {
  console.error('❌ Client error:', err);
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

server.on('connection', (socket) => {
  // Set socket timeout to prevent hanging connections
  socket.setTimeout(600000); // 10 minutes
  
  socket.on('timeout', () => {
    console.warn('🕐 Socket timeout, destroying connection');
    socket.destroy();
  });
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`📴 Received ${signal}, shutting down gracefully...`);
  
  server.close((err) => {
    if (err) {
      console.error('❌ Error during shutdown:', err);
      process.exit(1);
    }
    
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⏰ Forced shutdown after 30s timeout');
    process.exit(1);
  }, 30000);
};

// Handle various shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  // In production, you might want to restart the process
  // For now, just log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  // Log the error but don't exit - let the application continue
});

// Log process warnings
process.on('warning', (warning) => {
  console.warn('⚠️ Node.js warning:', warning.name, warning.message);
});

// Export for testing purposes
export default app;
