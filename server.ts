import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { log, logError, setupLogging } from '@utils/logger.js';
import { oracleRoutes } from '@routes/oracle.js';
import { healthRoutes } from '@routes/health.js';
import { OracleService } from '@services/oracleService.js';
import { discordNotifier } from '@utils/discordNotifier.js';
import { serverConfig, oracleConfig, IS_DEVELOPMENT } from '@configs/index.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Logs directory
const logsDir = join(__dirname, 'logs');

// Setup logging
setupLogging(logsDir);

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use(
  morgan('combined', {
    stream: createWriteStream(join(logsDir, 'access.log'), { flags: 'a' }),
  })
);

// Initialize Oracle service
const oracleService = new OracleService();
oracleService.initialize().catch(async (error: Error) => {
  logError('Failed to initialize Oracle Service:', error);
  await discordNotifier.sendErrorAlert(error, {
    operation: 'server_startup',
    service: 'OracleService',
  });
});

// Routes
app.use('/api/oracle', oracleRoutes(oracleService));
app.use('/api/health', healthRoutes);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Aleo Oracle Gateway',
  });
});

// Error handling middleware
app.use(async (err: Error, req: Request, res: Response, _: NextFunction) => {
  logError('Unhandled error:', err);

  // Send Discord notification for unhandled errors
  await discordNotifier.sendErrorAlert(err, {
    operation: 'unhandled_error',
    url: req.url,
    method: req.method,
    userAgent: req.get('User-Agent') as string,
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: IS_DEVELOPMENT ? err.message : 'Something went wrong',
  });
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
  });
});

const { host: HOST, port: PORT } = serverConfig;

// Start server
app.listen(PORT, HOST, async () => {
  log(`🚀 Server running on ${HOST}:${PORT}`);
  log(`📊 Health check: http://${HOST}:${PORT}/api/health`);
  log(`🔗 Oracle API: http://${HOST}:${PORT}/api/oracle`);

  // Send Discord notification for server startup
  await discordNotifier.sendServiceStatusAlert('API Server', 'online', {
    host: HOST,
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    supportedCoins: oracleConfig.supportedCoins,
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logError('SIGTERM received, shutting down gracefully...');
  await discordNotifier.sendServiceStatusAlert('API Server', 'offline', {
    reason: 'SIGTERM received',
  });
  process.exit(0);
});

process.on('SIGINT', async () => {
  logError('SIGINT received, shutting down gracefully...');
  await discordNotifier.sendServiceStatusAlert('API Server', 'offline', {
    reason: 'SIGINT received',
  });
  process.exit(0);
});

export default app;
