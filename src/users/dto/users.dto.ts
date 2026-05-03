import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {  NotificationModule } from '../../notification/schemas/notification.schema';

const SearchUsersListSchema = z.object({
  query: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const UpdateNotificationSettingsSchema = z
  .object({
    emailNotificationsEnabled: z.boolean().optional(),
    smsNotificationsEnabled: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
    notificationModules: z
      .partialRecord(z.enum(NotificationModule), z.boolean())
      .optional(),
  })
  .strict();

export class UpdateNotificationSettingsDto extends createZodDto(UpdateNotificationSettingsSchema) {}
export class SearchUsersListDto extends   createZodDto(SearchUsersListSchema) {}
