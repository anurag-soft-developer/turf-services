import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const candidates = [
  resolve(process.cwd(), 'apps/socket/.env'),
  resolve(process.cwd(), '.env'),
  resolve(__dirname, '../../.env'),
];
for (const path of candidates) {
  if (existsSync(path)) {
    dotenv.config({ path });
    break;
  }
}

class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`Environment validation error: ${message}`);
    this.name = 'ConfigValidationError';
  }
}

export function validateConfig() {
  try {
    const config = {
      // Application
      PORT: process.env.PORT || '3001',
      NODE_ENV: process.env.NODE_ENV || 'development',
      APP_NAME: process.env.APP_NAME || 'turf-socket',
      APP_VERSION: process.env.APP_VERSION || '1.0.0',

      // Redis
      REDIS_URL: process.env.REDIS_URL!,

      // Chat runtime tuning
      CHAT_HISTORY_SIZE: process.env.CHAT_HISTORY_SIZE || '100',
      CHAT_FLUSH_BATCH_SIZE: process.env.CHAT_FLUSH_BATCH_SIZE || '200',
      CHAT_FLUSH_INTERVAL_MS: process.env.CHAT_FLUSH_INTERVAL_MS || '5000',

      // Primary API integration
      TURF_SERVICES_BASE_URL: process.env.TURF_SERVICES_BASE_URL!,
      INTERNAL_TOKEN: process.env.INTERNAL_TOKEN!,

      // JWT validation for websocket handshake
      JWT_SECRET: process.env.JWT_SECRET!,
    };

    const missingKeys = Object.entries(config)
      .filter(([_, value]) => !value?.toString().length)
      .map(([key, _]) => key);

    if (missingKeys.length) {
      throw new ConfigValidationError(
        `Missing required environment variables: ${missingKeys.join(', ')}`,
      );
    }

    return config;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(`\n❌ Configuration Error:`);
      console.error(`${error.message}\n`);
      console.error(`Please check your .env file and fix the above error.\n`);
      process.exit(1);
    }
    throw error;
  }
}

export const config = validateConfig();
