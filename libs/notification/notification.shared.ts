import { z } from 'zod';

export const notificationDispatchSchema = z.object({
  userId: z.string().trim().min(1),
  notificationId: z.string().trim().min(1),
  module: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  data: z.record(z.string(), z.string()).optional(),
  createdAt: z.string().datetime(),
});

export type NotificationDispatchPayload = z.infer<
  typeof notificationDispatchSchema
>;

export const notificationPushEventSchema = z.object({
  notificationId: z.string(),
  module: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.string()).optional(),
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime(),
});

export type NotificationPushEvent = z.infer<typeof notificationPushEventSchema>;
