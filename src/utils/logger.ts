/**
 * Logging Module
 *
 * This module provides a centralized logging system using Winston. It supports
 * multiple log levels, file and console output, and structured logging for
 * the Aleo Oracle system. The logger is configured based on server configuration
 * and provides convenience methods for different log levels.
 *
 */

import winston from 'winston';
import { join } from 'node:path';
import { serverConfig } from '@configs/index.js';

/**
 * Global logger instance
 * Initialized by setupLogging() and used by all logging functions
 */
let logger: winston.Logger | undefined;

/**
 * Console log format configuration
 * Includes timestamp, colorization, and structured output
 */
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level}]: ${message}`;
  })
);

/**
 * File log format configuration
 * Includes timestamp and structured output for file logging
 */
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${level.toUpperCase()}] ${timestamp} ${message}`;
  })
);

/**
 * Initialize the logging system
 *
 * This function sets up the Winston logger with console and file transports.
 * It creates separate log files for different log levels and configures
 * the logging format for both console and file output.
 *
 * @param logsDir - Directory path where log files will be stored
 *
 * @returns Configured Winston logger instance
 *
 * @throws {Error} If the logs directory cannot be created or accessed
 */
export const setupLogging = (logsDir: string): winston.Logger => {
  // Create transports
  const transports: winston.transport[] = [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
    }),

    // File transports
    new winston.transports.File({
      filename: join(logsDir, 'app.log'),
      format: fileFormat,
    }),

    new winston.transports.File({
      filename: join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
    }),

    new winston.transports.File({
      filename: join(logsDir, 'warn.log'),
      level: 'warn',
      format: fileFormat,
    }),

    new winston.transports.File({
      filename: join(logsDir, 'debug.log'),
      level: 'debug',
      format: fileFormat,
    }),
  ];

  // Create logger
  logger = winston.createLogger({
    level: serverConfig.logLevel,
    transports,
  });

  logger.info('Logging system initialized');
  return logger;
};

/**
 * Get the logger instance
 * @returns The logger instance
 */
export const getLogger = (): winston.Logger => {
  if (!logger) {
    throw new Error('Logger not initialized. Call setupLogging() first.');
  }
  return logger;
};

/**
 * Log a message
 * @param message - The message to log
 * @param data - The data to log
 */
export const log = (message: string, ...data: any[]): void => {
  if (logger) logger.info(message, ...data);
};

/**
 * Log an error message
 * @param message - The message to log
 * @param data - The data to log
 */
export const logError = (message: string, ...data: any[]): void => {
  if (logger) logger.error(message, ...data);
};

/**
 * Log a warning message
 * @param message - The message to log
 * @param data - The data to log
 */
export const logWarn = (message: string, ...data: any[]): void => {
  if (logger) logger.warn(message, ...data);
};

/**
 * Log a debug message
 * @param message - The message to log
 * @param data - The data to log
 */
export const logDebug = (message: string, ...data: any[]): void => {
  if (logger) logger.debug(message, ...data);
};
