import { config } from './env.config';

export function getRedisUrl(): string {
  return config.REDIS_URL;
}
