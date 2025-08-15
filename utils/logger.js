import winston from 'winston';
import { promises as fs } from 'fs';
import path from 'path';

// Create a simple console-only logger for fallback
const initLogger = winston.createLogger({
  level: 'info',
  transports: [new winston.transports.Console()]
});

function createProductionLoggerSync() {
  try {
    const logDir = path.join(process.cwd(), 'logs');
    // fs.mkdirSync is safe here, doesn't throw if exists
    try { require('fs').mkdirSync(logDir, { recursive: true }); } catch (e) {}
    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} [${info.level}]: ${info.message}`)
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: path.join(logDir, 'application.log'),
          maxsize: 5 * 1024 * 1024 // 5MB
        })
      ]
    });
  } catch (error) {
    initLogger.error('Failed to create production logger:', error);
    return initLogger;
  }
}

// Export immediately usable logger (no async/await)
const logger = process.env.NODE_ENV === 'production'
  ? createProductionLoggerSync()
  : winston.createLogger({
      level: 'debug',
      transports: [new winston.transports.Console()]
    });

export default logger;
