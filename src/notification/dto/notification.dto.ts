import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { NotificationModule } from '../schemas/notification.schema';

const createNotificationSchema = z.object({
  recipientUserId: z.string().trim().min(1),
  module: z.enum(NotificationModule),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  data: z.record(z.string(), z.unknown()).optional(),
  sourceType: z.string().trim().max(64).optional(),
  sourceId: z.string().trim().max(120).optional(),
});

const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  module: z.enum(NotificationModule).optional(),
});

export class CreateNotificationDto extends createZodDto(
  createNotificationSchema,
) {}
export class ListNotificationsQueryDto extends createZodDto(
  listNotificationsQuerySchema,
) {}
