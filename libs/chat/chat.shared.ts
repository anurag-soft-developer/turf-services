import z from 'zod';

export const chatScopeSchema = z.enum(['team', 'match', 'player']);
export type ChatScope = z.infer<typeof chatScopeSchema>;

export const chatRefSchema = z.object({
  scope: chatScopeSchema,
  scopeId: z.string().trim().min(1),
});
export type ChatRef = z.infer<typeof chatRefSchema>;

export const chatBodySchema = z.string().trim().min(1).max(4000);


/** Quick-react presets. Any short emoji string is accepted as a reaction. */
export const chatReactionEmojiSchema = z.string().trim().min(1).max(64);
export type ChatReactionEmoji = z.infer<typeof chatReactionEmojiSchema>;

export const sendMessageEventSchema = chatRefSchema.extend({
  body: chatBodySchema,
  clientMessageId: z.string().trim().min(1).max(120).optional(),
  replyToMessageId: z.string().trim().min(1).max(120).optional(),
});
export type SendMessageEvent = z.infer<typeof sendMessageEventSchema>;

export const chatMessageSchema = chatRefSchema.extend({
  messageId: z.string().trim().min(1),
  senderUserId: z.string().trim().min(1),
  body: chatBodySchema,
  createdAt: z.string().datetime(),
  replyToMessageId: z.string().trim().min(1).optional(),
  replyToBody: z.string().trim().max(4000).optional(),
  replyToSenderUserId: z.string().trim().min(1).optional(),
  /** emoji → userIds */
  reactions: z.record(z.string(), z.array(z.string())).optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const batchPersistChatMessageSchema = chatMessageSchema
  .omit({ reactions: true })
  .extend({
    idempotencyKey: z.string().trim().min(1).max(120),
  });
export type BatchPersistChatMessage = z.infer<
  typeof batchPersistChatMessageSchema
>;

export const batchPersistRequestSchema = z.object({
  messages: z.array(batchPersistChatMessageSchema).min(1).max(500),
});
export type BatchPersistRequest = z.infer<typeof batchPersistRequestSchema>;

export const reactToMessageEventSchema = chatRefSchema.extend({
  messageId: z.string().trim().min(1),
  emoji: chatReactionEmojiSchema,
});
export type ReactToMessageEvent = z.infer<typeof reactToMessageEventSchema>;

export const chatReactionUpdatedEventSchema = chatRefSchema.extend({
  messageId: z.string().trim().min(1),
  reactions: z.record(z.string(), z.array(z.string())),
});
export type ChatReactionUpdatedEvent = z.infer<
  typeof chatReactionUpdatedEventSchema
>;

export const toggleChatReactionInternalSchema = reactToMessageEventSchema.extend(
  {
    userId: z.string().trim().min(1),
  },
);
export type ToggleChatReactionInternal = z.infer<
  typeof toggleChatReactionInternalSchema
>;

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

export function uniqueChatRefs(refs: ChatRef[]): ChatRef[] {
  const seen = new Set<string>();
  const unique: ChatRef[] = [];
  for (const ref of refs) {
    const key = getChatRoomKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
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
  /** Case-insensitive match on player full name or team name. Match chats are excluded. */
  search: z.string().trim().min(1).max(80).optional(),
});
export type ChatInboxQuery = z.infer<typeof chatInboxQuerySchema>;

export const chatInboxItemSchema = chatRefSchema.extend({
  title: z.string(),
  imageUrl: z.string().optional(),
  /** Second team logo for match chats (from/to pair). */
  secondaryImageUrl: z.string().optional(),
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

export const chatHideEventSchema = chatRefSchema.extend({
  hiddenAt: z.string().datetime(),
});
export type ChatHideEvent = z.infer<typeof chatHideEventSchema>;

export const hideChatThreadsSchema = z.object({
  items: z.array(chatRefSchema).min(1).max(100),
});
export type HideChatThreadsBody = z.infer<typeof hideChatThreadsSchema>;

export const chatHideResultSchema = z.object({
  items: z.array(chatHideEventSchema).min(1),
});
export type ChatHideResult = z.infer<typeof chatHideResultSchema>;

export const deleteChatMessageSchema = chatRefSchema.extend({
  messageId: z.string().trim().min(1),
});
export type DeleteChatMessage = z.infer<typeof deleteChatMessageSchema>;

export const deleteChatMessageInternalSchema = deleteChatMessageSchema.extend({
  userId: z.string().trim().min(1),
  body: chatBodySchema.optional(),
  createdAt: z.string().datetime().optional(),
});
export type DeleteChatMessageInternal = z.infer<
  typeof deleteChatMessageInternalSchema
>;

export const chatMessageDeletedEventSchema = chatRefSchema.extend({
  messageId: z.string().trim().min(1),
  deletedAt: z.string().datetime(),
  inboxUpdated: chatInboxUpdatedEventSchema.nullable(),
});
export type ChatMessageDeletedEvent = z.infer<
  typeof chatMessageDeletedEventSchema
>;

export function chatMessageToInboxUpdated(
  message: ChatMessage,
): ChatInboxUpdatedEvent {
  return {
    scope: message.scope,
    scopeId: message.scopeId,
    lastMessageId: message.messageId,
    lastMessageBody: message.body,
    lastSenderUserId: message.senderUserId,
    lastMessageAt: message.createdAt,
  };
}
