import z from 'zod';
import { createZodDto } from 'nestjs-zod';
import {
  batchPersistRequestSchema,
  chatAccessQuerySchema,
  chatHistoryQuerySchema,
  chatInboxQuerySchema,
  chatRefSchema,
  hideChatThreadsSchema,
  markChatReadInternalSchema,
} from '../../../../../libs';

const batchPersistMessagesSchema = batchPersistRequestSchema;
export class BatchPersistMessagesDto extends createZodDto(
  batchPersistMessagesSchema,
) {}

const listChatMessagesQuerySchema = chatHistoryQuerySchema.extend({
  before: z.string().datetime().optional(),
});
export class ListChatMessagesQueryDto extends createZodDto(
  listChatMessagesQuerySchema,
) {}

const internalListChatMessagesQuerySchema = listChatMessagesQuerySchema.extend({
  userId: z.string().trim().min(1),
});
export class InternalListChatMessagesQueryDto extends createZodDto(
  internalListChatMessagesQuerySchema,
) {}

export class ListChatInboxQueryDto extends createZodDto(chatInboxQuerySchema) {}

export class ChatReadBodyDto extends createZodDto(chatRefSchema) {}

export class ChatHideBodyDto extends createZodDto(hideChatThreadsSchema) {}

export class ListChatReadCursorsQueryDto extends createZodDto(chatRefSchema) {}

export class InternalChatAccessQueryDto extends createZodDto(
  chatAccessQuerySchema,
) {}

export class InternalMarkChatReadDto extends createZodDto(
  markChatReadInternalSchema,
) {}
