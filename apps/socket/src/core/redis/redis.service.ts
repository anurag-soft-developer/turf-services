import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import { getRedisUrl } from '../config/redis.config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private pubClient: RedisClientType | null = null;
  private subClient: RedisClientType | null = null;

  async getClient(): Promise<RedisClientType> {
    if (!this.client) {
      this.client = createClient({ url: getRedisUrl() });
      this.attachErrorLogger(this.client, 'redis-client');
      try {
        await this.client.connect();
        this.logger.log('Redis connected: redis-client');
      } catch {
        this.logger.error('Redis connection failed: redis-client');
        throw new Error('Redis connection failed: redis-client');
      }
    }
    return this.client;
  }

  async getPubSubClients(): Promise<{
    pubClient: RedisClientType;
    subClient: RedisClientType;
  }> {
    if (!this.pubClient || !this.subClient) {
      this.pubClient = createClient({ url: getRedisUrl() });
      this.subClient = this.pubClient.duplicate();
      this.attachErrorLogger(this.pubClient, 'redis-pub');
      this.attachErrorLogger(this.subClient, 'redis-sub');
      try {
        await this.pubClient.connect();
        this.logger.log('Redis connected: redis-pub');
        await this.subClient.connect();
        this.logger.log('Redis connected: redis-sub');
      } catch {
        this.logger.error('Redis connection failed: pub/sub');
        throw new Error('Redis connection failed: pub/sub');
      }
    }
    return { pubClient: this.pubClient, subClient: this.subClient };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.client?.quit(),
      this.pubClient?.quit(),
      this.subClient?.quit(),
    ]);
  }

  private attachErrorLogger(client: RedisClientType, label: string): void {
    client.on('error', () => {
      this.logger.error(`Redis runtime error: ${label}`);
    });
  }
}
