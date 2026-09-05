import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { isAxiosError } from 'axios';
import { randomUUID } from 'crypto';
import {
  ChatAccessResponse,
  ChatInboxUpdatedEvent,
  ChatMessage,
  ChatMessageDeletedEvent,
  ChatReadEvent,
  ChatRef,
  SendMessageEvent,
  batchPersistRequestSchema,
  chatAccessResponseSchema,
  chatMessageDeletedEventSchema,
  chatMessageSchema,
  chatMessageToInboxUpdated,
  chatReadEventSchema,
  deleteChatMessageSchema,
  getChatRoomKey,
  sendMessageEventSchema,
} from '../../../../libs';
import { config } from '../core/config/env.config';
import { internalHttp } from '../core/http/http.client';
import { RedisService } from '../core/redis/redis.service';

@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatService.name);
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly redisService: RedisService) {}

  onModuleInit(): void {
    this.flushTimer = setInterval(() => {
      void this.flushPendingMessages();
    }, Number(config.CHAT_FLUSH_INTERVAL_MS));
  }

  onModuleDestroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }

  async assertAccess(
    userId: string,
    ref: ChatRef,
  ): Promise<ChatAccessResponse> {
    try {
      const { data } = await internalHttp.get('/chat/access/internal', {
        params: {
          scope: ref.scope,
          scopeId: ref.scopeId,
          userId,
        },
      });
      const parsed = chatAccessResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new WsException('Forbidden');
      }
      return parsed.data;
    } catch {
      throw new WsException('Forbidden');
    }
  }

  async joinRoom(
    userId: string,
    ref: ChatRef,
  ): Promise<{ room: string; participantUserIds: string[] }> {
    const access = await this.assertAccess(userId, ref);
    return {
      room: getChatRoomKey(ref),
      participantUserIds: access.participantUserIds,
    };
  }

  async sendMessage(
    senderUserId: string,
    payload: unknown,
  ): Promise<{
    room: string;
    message: ChatMessage;
    participantUserIds: string[];
    inboxUpdated: ChatInboxUpdatedEvent;
  }> {
    const parsed = sendMessageEventSchema.parse(payload) as SendMessageEvent;
    const access = await this.assertAccess(senderUserId, parsed);
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

    await client
      .multi()
      .lPush(historyKey, JSON.stringify(message))
      .lTrim(historyKey, 0, Number(config.CHAT_HISTORY_SIZE) - 1)
      .rPush(queueKey, JSON.stringify(queueItem))
      .exec();

    try {
      await this.markRead(senderUserId, parsed);
    } catch (error) {
      this.logger.warn(
        `Failed to mark sender read after send: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      room,
      message,
      participantUserIds: access.participantUserIds,
      inboxUpdated: chatMessageToInboxUpdated(message),
    };
  }

  async deleteMessage(
    userId: string,
    payload: unknown,
  ): Promise<{
    room: string;
    deleted: ChatMessageDeletedEvent;
    participantUserIds: string[];
  }> {
    const parsed = deleteChatMessageSchema.parse(payload);
    const access = await this.assertAccess(userId, parsed);
    const room = getChatRoomKey(parsed);
    const historyKey = this.getHistoryKey(room);
    const client = await this.redisService.getClient();
    const rawHistory = await client.lRange(historyKey, 0, -1);

    let cached: ChatMessage | null = null;
    let cachedRaw: string | null = null;
    for (const item of rawHistory) {
      const message = this.parseCachedMessage(item);
      if (!message || message.messageId !== parsed.messageId) {
        continue;
      }
      cached = message;
      cachedRaw = item;
      break;
    }

    if (cached && cached.senderUserId !== userId) {
      throw new WsException('You can only delete your own messages');
    }

    try {
      const { data } = await internalHttp.post(
        '/chat/messages/delete/internal',
        {
          userId,
          messageId: parsed.messageId,
          scope: parsed.scope,
          scopeId: parsed.scopeId,
          ...(cached ? { body: cached.body, createdAt: cached.createdAt } : {}),
        },
      );
      const result = chatMessageDeletedEventSchema.parse(data);
      await client.set(this.getDeletedKey(parsed.messageId), '1', {
        EX: 3600,
      });
      if (cachedRaw) {
        await client.lRem(historyKey, 1, cachedRaw);
      }

      const remainingRaw = await client.lRange(historyKey, 0, 0);
      const remaining = remainingRaw[0]
        ? this.parseCachedMessage(remainingRaw[0])
        : null;
      const inboxUpdated = remaining
        ? chatMessageToInboxUpdated(remaining)
        : result.inboxUpdated;

      return {
        room,
        deleted: { ...result, inboxUpdated },
        participantUserIds: access.participantUserIds,
      };
    } catch (error) {
      if (error instanceof WsException) {
        throw error;
      }
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 403) {
        throw new WsException('You can only delete your own messages');
      }
      if (status === 404) {
        throw new WsException('Message not found');
      }
      throw new WsException('Failed to delete message');
    }
  }

  async markRead(userId: string, ref: ChatRef): Promise<ChatReadEvent> {
    try {
      const { data } = await internalHttp.post('/chat/read/internal', {
        userId,
        scope: ref.scope,
        scopeId: ref.scopeId,
      });
      const parsed = chatReadEventSchema.safeParse(data);
      if (!parsed.success) {
        throw new WsException('Failed to mark chat as read');
      }
      return parsed.data;
    } catch {
      throw new WsException('Failed to mark chat as read');
    }
  }

  async getRecentHistory(
    userId: string,
    ref: ChatRef,
    limit = 30,
  ): Promise<ChatMessage[]> {
    await this.assertAccess(userId, ref);
    const room = getChatRoomKey(ref);
    const historyKey = this.getHistoryKey(room);
    const client = await this.redisService.getClient();
    const raw = await client.lRange(historyKey, 0, Math.max(limit - 1, 0));
    const cached = raw
      .map((item) => this.parseCachedMessage(item))
      .filter((item): item is ChatMessage => !!item);
    const liveCached = cached.length
      ? await this.excludeDeletedMessages(client, cached)
      : [];

    if (liveCached.length > 0) {
      return liveCached;
    }

    try {
      const { data } = await internalHttp.get('/chat/messages/internal', {
        params: {
          scope: ref.scope,
          scopeId: ref.scopeId,
          userId,
          limit: String(limit),
        },
      });
      if (!Array.isArray(data)) {
        return [];
      }
      return data
        .map((item) => {
          const result = chatMessageSchema.safeParse(item);
          return result.success ? result.data : null;
        })
        .filter((item): item is ChatMessage => !!item);
    } catch {
      return [];
    }
  }

  private async flushPendingMessages(): Promise<void> {
    const client = await this.redisService.getClient();
    const queueKey = this.getQueueKey();
    const chunk = await client.lRange(
      queueKey,
      0,
      Number(config.CHAT_FLUSH_BATCH_SIZE) - 1,
    );
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

    const toPersist = await this.excludeDeletedMessages(
      client,
      parsed.data.messages,
    );
    if (!toPersist.length) {
      await client.lTrim(queueKey, chunk.length, -1);
      return;
    }

    try {
      await internalHttp.post('/chat/messages/batch', { messages: toPersist });
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(
        status
          ? `Batch flush failed with status ${status}`
          : `Batch flush failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    await client.lTrim(queueKey, chunk.length, -1);
  }

  private parseCachedMessage(item: string): ChatMessage | null {
    try {
      return chatMessageSchema.parse(JSON.parse(item));
    } catch {
      return null;
    }
  }

  private async excludeDeletedMessages<T extends { messageId: string }>(
    client: Awaited<ReturnType<RedisService['getClient']>>,
    messages: T[],
  ): Promise<T[]> {
    if (!messages.length) {
      return messages;
    }
    const flags = await Promise.all(
      messages.map((message) =>
        client.exists(this.getDeletedKey(message.messageId)),
      ),
    );
    return messages.filter((_, index) => !flags[index]);
  }

  private getHistoryKey(room: string): string {
    return `chat:history:${room}`;
  }

  private getDeletedKey(messageId: string): string {
    return `chat:deleted:${messageId}`;
  }

  private getQueueKey(): string {
    return 'chat:queue:pending';
  }
}
