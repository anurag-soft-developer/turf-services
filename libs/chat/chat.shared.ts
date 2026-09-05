import z from 'zod';

export const chatScopeSchema = z.enum(['team', 'match', 'player']);
export type ChatScope = z.infer<typeof chatScopeSchema>;

export const chatRefSchema = z.object({
  scope: chatScopeSchema,
  scopeId: z.string().trim().min(1),
});
export type ChatRef = z.infer<typeof chatRefSchema>;

export const chatBodySchema = z.string().trim().min(1).max(4000);

export const sendMessageEventSchema = chatRefSchema.extend({
  body: chatBodySchema,
  clientMessageId: z.string().trim().min(1).max(120).optional(),
});
export type SendMessageEvent = z.infer<typeof sendMessageEventSchema>;

export const chatMessageSchema = chatRefSchema.extend({
  messageId: z.string().trim().min(1),
  senderUserId: z.string().trim().min(1),
  body: chatBodySchema,
  createdAt: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const batchPersistChatMessageSchema = chatMessageSchema.extend({
  idempotencyKey: z.string().trim().min(1).max(120),
});
export type BatchPersistChatMessage = z.infer<
  typeof batchPersistChatMessageSchema
>;

export const batchPersistRequestSchema = z.object({
  messages: z.array(batchPersistChatMessageSchema).min(1).max(500),
});
export type BatchPersistRequest = z.infer<typeof batchPersistRequestSchema>;

export const chatHistoryQuerySchema = chatRefSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().datetime().optional(),
});
export type ChatHistoryQuery = z.infer<typeof chatHistoryQuerySchema>;

export function normalizePlayerScopeId(
  firstUserId: string,
  secondUserId: string,
): string {
  return [firstUserId.trim(), secondUserId.trim()].sort().join(':');
}

export function getChatRoomKey(ref: ChatRef): string {
  return `chat:${ref.scope}:${ref.scopeId}`;
}

export function getChatUserRoomKey(userId: string): string {
  return `user:${userId.trim()}`;
}

/** Other participant in a `player` scopeId, or null if `userId` is not in the pair. */
export function getOtherPlayerId(
  scopeId: string,
  userId: string,
): string | null {
  const parts = scopeId.split(':').filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }
  if (parts[0] === userId) {
    return parts[1];
  }
  if (parts[1] === userId) {
    return parts[0];
  }
  return null;
}

export const chatInboxQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ChatInboxQuery = z.infer<typeof chatInboxQuerySchema>;

export const chatInboxItemSchema = chatRefSchema.extend({
  title: z.string(),
  imageUrl: z.string().optional(),
  lastMessageId: z.string(),
  lastMessageBody: z.string(),
  lastSenderUserId: z.string(),
  lastMessageAt: z.string().datetime(),
  unreadCount: z.number().int().nonnegative(),
});
export type ChatInboxItem = z.infer<typeof chatInboxItemSchema>;

export const chatInboxUpdatedEventSchema = chatRefSchema.extend({
  lastMessageId: z.string(),
  lastMessageBody: z.string(),
  lastSenderUserId: z.string(),
  lastMessageAt: z.string().datetime(),
});
export type ChatInboxUpdatedEvent = z.infer<typeof chatInboxUpdatedEventSchema>;

export const chatReadEventSchema = chatRefSchema.extend({
  userId: z.string().trim().min(1),
  lastReadAt: z.string().datetime(),
});
export type ChatReadEvent = z.infer<typeof chatReadEventSchema>;

export const chatReadCursorSchema = z.object({
  userId: z.string().trim().min(1),
  lastReadAt: z.string().datetime(),
});
export type ChatReadCursor = z.infer<typeof chatReadCursorSchema>;

export const chatAccessQuerySchema = chatRefSchema.extend({
  userId: z.string().trim().min(1),
});
export type ChatAccessQuery = z.infer<typeof chatAccessQuerySchema>;

export const chatAccessResponseSchema = z.object({
  ok: z.literal(true),
  participantUserIds: z.array(z.string()),
});
export type ChatAccessResponse = z.infer<typeof chatAccessResponseSchema>;

export const markChatReadInternalSchema = chatRefSchema.extend({
  userId: z.string().trim().min(1),
});
export type MarkChatReadInternal = z.infer<typeof markChatReadInternalSchema>;
