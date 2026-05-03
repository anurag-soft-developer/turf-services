import * as dotenv from 'dotenv';
dotenv.config();
import type { StringValue } from 'ms';
class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`Environment validation error: ${message}`);
    this.name = 'ConfigValidationError';
  }
}

export function validateConfig() {
  try {
    const config = {
      // Database
      MONGODB_URI: process.env.MONGODB_URI!,

      // JWT
      JWT_SECRET: process.env.JWT_SECRET!,
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN as StringValue,
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
      JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN as StringValue,
      COOKIE_DOMAIN: process.env.COOKIE_DOMAIN!,

      // Google OAuth
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
      GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL!,

      // Application
      PORT: process.env.PORT || '3000',
      NODE_ENV: process.env.NODE_ENV!,
      FRONTEND_URL: process.env.FRONTEND_URL!,
      APP_NAME: process.env.APP_NAME!,
      APP_VERSION: process.env.APP_VERSION || '1.0.0',

      // Razorpay
      RAJORPAY_KEY_ID: process.env.RAJORPAY_KEY_ID!,
      RAJORPAY_KEY_SECRET: process.env.RAJORPAY_KEY_SECRET!,
      RAJORPAY_WEBHOOK_SECRET: process.env.RAJORPAY_WEBHOOK_SECRET || '',

      // Email Configuration
      SMTP_HOST: process.env.SMTP_HOST!,
      SMTP_PORT: process.env.SMTP_PORT || '587',
      SMTP_USER: process.env.SMTP_USER!,
      SMTP_PASS: process.env.SMTP_PASS!,
      SMTP_FROM: process.env.SMTP_FROM!,

      // DigitalOcean Spaces
      SPACES_REGION: process.env.SPACES_REGION!,
      SPACES_ENDPOINT: process.env.SPACES_ENDPOINT!,
      SPACES_BUCKET: process.env.SPACES_BUCKET!,
      SPACES_ACCESS_KEY_ID: process.env.SPACES_ACCESS_KEY_ID!,
      SPACES_SECRET_ACCESS_KEY: process.env.SPACES_SECRET_ACCESS_KEY!,
      SPACES_CDN_BASE_URL: process.env.SPACES_CDN_BASE_URL || '',
      SPACES_SIGNED_URL_TTL_SECONDS:
        process.env.SPACES_SIGNED_URL_TTL_SECONDS || '900',

      CHAT_BATCH_INTERNAL_TOKEN: process.env.CHAT_BATCH_INTERNAL_TOKEN!,
      NOTIFICATION_INTERNAL_TOKEN:
        process.env.NOTIFICATION_INTERNAL_TOKEN || '',
      REALTIME_TURF_BASE_URL: process.env.REALTIME_TURF_BASE_URL || '',
      GOOGLE_APPLICATION_CREDENTIALS:
        process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
      FIREBASE_SERVICE_ACCOUNT_JSON:
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
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
