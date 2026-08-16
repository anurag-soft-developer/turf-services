import { config } from './env.config';

export interface ChatRuntimeConfig {
  port: number;
  redisUrl: string;
  chatHistorySize: number;
  flushBatchSize: number;
  flushIntervalMs: number;
  turfServicesBaseUrl: string;
  turfServicesBatchToken: string;
}

export function getChatRuntimeConfig(): ChatRuntimeConfig {
  return {
    port: Number(config.PORT),
    redisUrl: config.REDIS_URL,
    chatHistorySize: Number(config.CHAT_HISTORY_SIZE),
    flushBatchSize: Number(config.CHAT_FLUSH_BATCH_SIZE),
    flushIntervalMs: Number(config.CHAT_FLUSH_INTERVAL_MS),
    turfServicesBaseUrl: config.TURF_SERVICES_BASE_URL,
    turfServicesBatchToken: config.CHAT_BATCH_INTERNAL_TOKEN,
  };
}
