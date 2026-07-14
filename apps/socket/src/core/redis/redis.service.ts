import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import { getRedisUrl } from '../config/redis.config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: RedisClientType | null = null;
  private pubClient: RedisClientType | null = null;
  private subClient: RedisClientType | null = null;

  async getClient(): Promise<RedisClientType> {
    if (!this.client) {
      this.client = createClient({ url: getRedisUrl() });
      await this.client.connect();
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
      await this.pubClient.connect();
      await this.subClient.connect();
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
}
