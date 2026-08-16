import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import { config } from '../config/env.config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private connectFailed = false;

  /**
   * Returns a connected client, or null if Redis is unavailable.
   * Callers must treat null as “skip Redis” (Mongo fallback).
   */
  async getClient(): Promise<RedisClientType | null> {
    if (this.connectFailed) {
      return null;
    }
    if (this.client?.isOpen) {
      return this.client;
    }
    try {
      this.client = createClient({ url: config.REDIS_URL });
      this.client.on('error', () => {
        this.logger.error('Redis runtime error: redis-client');
      });
      await this.client.connect();
      this.logger.log('Redis connected: redis-client');
      return this.client;
    } catch {
      this.connectFailed = true;
      this.client = null;
      this.logger.error('Redis connection failed: redis-client');
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  async setNxEx(key: string, ttlSeconds: number, value = '1'): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;
    try {
      const result = await client.set(key, value, { NX: true, EX: ttlSeconds });
      return result === 'OK';
    } catch {
      return false;
    }
  }

  async incrHashField(
    key: string,
    field: string,
    amount: number,
  ): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    try {
      await client.hIncrBy(key, field, amount);
    } catch {
      /* ranking still works from Mongo */
    }
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const [hash] = await this.hGetAllMany([key]);
    return hash ?? {};
  }

  async hGetAllMany(keys: string[]): Promise<Record<string, string>[]> {
    if (!keys.length) return [];
    const client = await this.getClient();
    if (!client) return keys.map(() => ({}));
    try {
      const multi = client.multi();
      for (const key of keys) {
        multi.hGetAll(key);
      }
      const replies = await multi.exec();
      return keys.map((_, i) => toStringRecord(replies[i]));
    } catch {
      return keys.map(() => ({}));
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    const client = await this.getClient();
    if (!client) return;
    try {
      await client.del(keys);
    } catch {
      /* ignore */
    }
  }

  async sadd(key: string, members: string[], ttlSeconds?: number): Promise<void> {
    if (!members.length) return;
    const client = await this.getClient();
    if (!client) return;
    try {
      await client.sAdd(key, members);
      if (ttlSeconds != null) {
        await client.expire(key, ttlSeconds);
      }
    } catch {
      /* ignore */
    }
  }

  async smembers(key: string): Promise<string[]> {
    const client = await this.getClient();
    if (!client) return [];
    try {
      return await client.sMembers(key);
    } catch {
      return [];
    }
  }

  async get(key: string): Promise<string | null> {
    const client = await this.getClient();
    if (!client) return null;
    try {
      return await client.get(key);
    } catch {
      return null;
    }
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    try {
      await client.set(key, value, { EX: ttlSeconds });
    } catch {
      /* ignore */
    }
  }

  async scanKeys(match: string, count = 100): Promise<string[]> {
    const client = await this.getClient();
    if (!client) return [];
    const keys: string[] = [];
    try {
      for await (const key of client.scanIterator({ MATCH: match, COUNT: count })) {
        keys.push(String(key));
      }
    } catch {
      return keys;
    }
    return keys;
  }
}

function toStringRecord(reply: unknown): Record<string, string> {
  if (!reply || typeof reply !== 'object') return {};
  if (reply instanceof Map) {
    const out: Record<string, string> = {};
    for (const [key, value] of reply) {
      if (value != null) out[String(key)] = String(value);
    }
    return out;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(reply as Record<string, unknown>)) {
    if (value != null) out[key] = String(value);
  }
  return out;
}
