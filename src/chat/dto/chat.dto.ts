import z from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';
import { batchPersistRequestSchema, chatHistoryQuerySchema } from '../../package';

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
