import winston from 'winston';
import { promises as fs } from 'fs';
import path from 'path';

// Create a simple console-only logger for initialization
const initLogger = winston.createLogger({
  level: 'info',
  transports: [new winston.transports.Console()]
});

// Async function to create production logger
async function createProductionLogger() {
  try {
    const logDir = path.join(process.cwd(), 'logs');
    await fs.mkdir(logDir, { recursive: true });
    
    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} [${info.level}]: ${info.message}`)
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ 
          filename: 'logs/application.log',
          maxsize: 5 * 1024 * 1024 // 5MB
        })
      ]
    });
  } catch (error) {
    initLogger.error('Failed to create production logger:', error);
    return initLogger; // Fallback to console-only logger
  }
}

// Export immediately usable logger
const logger = process.env.NODE_ENV === 'production' 
  ? await createProductionLogger()
  : winston.createLogger({
      level: 'debug',
      transports: [new winston.transports.Console()]
    });

export default logger;
