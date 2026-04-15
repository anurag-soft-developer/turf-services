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
