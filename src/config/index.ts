import config from 'config';
import { configSchema } from '../utils/validationSchema.js';

const rawConfig = config.util.toObject();
const result = configSchema.safeParse(rawConfig);

if (!result.success) {
  console.error('Configuration validation failed:', result.error);
  process.exit(1);
}

// Environment detection
export const NODE_ENV: string = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION: boolean = NODE_ENV === 'production';
export const IS_DEVELOPMENT: boolean = NODE_ENV === 'development';

export const serverConfig = result.data.server;
export const discordConfig = result.data.discord;
export const cronConfig = result.data.cron;
export const oracleConfig = result.data.oracle;
export const securityConfig = result.data.security;
export const leoCliConfig = result.data.leoCli;
export const queueConfig = result.data.queue;
