import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ChatMessage,
  ChatRef,
  SendMessageEvent,
  batchPersistRequestSchema,
  chatMessageSchema,
  getChatRoomKey,
  sendMessageEventSchema,
} from '../../../../libs';
import { getChatRuntimeConfig } from '../core/config/chat.config';
import { RedisService } from '../core/redis/redis.service';

@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatService.name);
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly cfg = getChatRuntimeConfig();

  constructor(private readonly redisService: RedisService) {}

  onModuleInit(): void {
    this.flushTimer = setInterval(() => {
      void this.flushPendingMessages();
    }, this.cfg.flushIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }

  async joinRoom(ref: ChatRef): Promise<string> {
    return getChatRoomKey(ref);
  }

  async sendMessage(
    senderUserId: string,
    payload: unknown,
  ): Promise<{ room: string; message: ChatMessage }> {
    const parsed = sendMessageEventSchema.parse(payload) as SendMessageEvent;
    const room = getChatRoomKey(parsed);
    const message: ChatMessage = chatMessageSchema.parse({
      messageId: randomUUID(),
      scope: parsed.scope,
      scopeId: parsed.scopeId,
      senderUserId,
      body: parsed.body,
      createdAt: new Date().toISOString(),
    });

    const client = await this.redisService.getClient();
    const historyKey = this.getHistoryKey(room);
    const queueKey = this.getQueueKey();
    const queueItem = {
      ...message,
      idempotencyKey: `${message.messageId}:${senderUserId}`,
    };

    await client.multi()
      .lPush(historyKey, JSON.stringify(message))
      .lTrim(historyKey, 0, this.cfg.chatHistorySize - 1)
      .rPush(queueKey, JSON.stringify(queueItem))
      .exec();

    return { room, message };
  }

  async getRecentHistory(
    userId: string,
    ref: ChatRef,
    limit = 30,
  ): Promise<ChatMessage[]> {
    const room = getChatRoomKey(ref);
    const historyKey = this.getHistoryKey(room);
    const client = await this.redisService.getClient();
    const raw = await client.lRange(historyKey, 0, Math.max(limit - 1, 0));
    const cached = raw
      .map((item) => {
        try {
          return chatMessageSchema.parse(JSON.parse(item));
        } catch {
          return null;
        }
      })
      .filter((item): item is ChatMessage => !!item);

    if (cached.length > 0) {
      return cached;
    }

    if (!this.cfg.turfServicesBatchToken) {
      return [];
    }

    const params = new URLSearchParams({
      scope: ref.scope,
      scopeId: ref.scopeId,
      userId,
      limit: String(limit),
    });

    const response = await fetch(
      `${this.cfg.turfServicesBaseUrl}/chat/messages/internal?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'x-internal-token': this.cfg.turfServicesBatchToken,
        },
      },
    );

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as unknown[];
    const parsed = data
      .map((item) => {
        const result = chatMessageSchema.safeParse(item);
        return result.success ? result.data : null;
      })
      .filter((item): item is ChatMessage => !!item);
    return parsed;
  }

  private async flushPendingMessages(): Promise<void> {
    if (!this.cfg.turfServicesBatchToken) {
      return;
    }

    const client = await this.redisService.getClient();
    const queueKey = this.getQueueKey();
    const chunk = await client.lRange(queueKey, 0, this.cfg.flushBatchSize - 1);
    if (!chunk.length) {
      return;
    }

    const messages = chunk
      .map((item) => {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      })
      .filter((item) => !!item);

    const parsed = batchPersistRequestSchema.safeParse({ messages });
    if (!parsed.success) {
      await client.lTrim(queueKey, chunk.length, -1);
      this.logger.warn('Dropped invalid batch messages while flushing queue');
      return;
    }

    const response = await fetch(
      `${this.cfg.turfServicesBaseUrl}/chat/messages/batch`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': this.cfg.turfServicesBatchToken,
        },
        body: JSON.stringify(parsed.data),
      },
    );

    if (!response.ok) {
      this.logger.warn(`Batch flush failed with status ${response.status}`);
      return;
    }

    await client.lTrim(queueKey, chunk.length, -1);
  }

  private getHistoryKey(room: string): string {
    return `chat:history:${room}`;
  }

  private getQueueKey(): string {
    return 'chat:queue:pending';
  }
}
