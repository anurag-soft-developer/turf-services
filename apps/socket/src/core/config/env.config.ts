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
    const chatFlushSeconds = (() => {
      const parsed = Number(process.env.CHAT_FLUSH_INTERVAL_MS || '5000');
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return 5;
      }
      return Math.max(1, Math.round(parsed / 1000));
    })();

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
      CHAT_FLUSH_CRON:
        process.env.CHAT_FLUSH_CRON || `*/${chatFlushSeconds} * * * * *`,
      CHAT_FLUSH_LOCK_TTL_SECONDS: Math.max(15, chatFlushSeconds + 10),

      // Scheduled jobs (socket ticks; turf-services runs the work)
      PAYMENT_HOLD_RELEASE_CRON:
        process.env.PAYMENT_HOLD_RELEASE_CRON || '*/2 * * * *',
      TEAM_INVITE_EXPIRY_CRON:
        process.env.TEAM_INVITE_EXPIRY_CRON || '0 * * * *',
      TEAM_MATCH_EXPIRY_CRON:
        process.env.TEAM_MATCH_EXPIRY_CRON || '*/5 * * * *',
      ENGAGEMENT_STATS_FLUSH_CRON:
        process.env.ENGAGEMENT_STATS_FLUSH_CRON || '*/2 * * * *',
      UNUSED_UPLOAD_REGISTRY_PURGE_CRON:
        process.env.UNUSED_UPLOAD_REGISTRY_PURGE_CRON || '0 * * * *',

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
