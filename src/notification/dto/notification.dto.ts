import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { NotificationModule } from '../schemas/notification.schema';
import type {
  ConnectionNotificationData,
  EventBookingNotificationData,
  MatchmakingNotificationData,
  TeamNotificationData,
  TurfApprovalNotificationData,
  TurfBookingNotificationData,
  WithdrawalNotificationData,
} from '../types/notification-data.types';

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

type NotificationPayloadBase = {
  title: string;
  body: string;
  sourceType?: string;
  sourceId?: string;
};

export type CreateNotificationInput =
  | (NotificationPayloadBase & {
      recipientUserId: string;
      module: NotificationModule.TURF_BOOKING;
      data: TurfBookingNotificationData;
    })
  | (NotificationPayloadBase & {
      recipientUserId: string;
      module: NotificationModule.EVENT_BOOKING;
      data: EventBookingNotificationData;
    })
  | (NotificationPayloadBase & {
      recipientUserId: string;
      module: NotificationModule.MATCHMAKING;
      data: MatchmakingNotificationData;
    })
  | (NotificationPayloadBase & {
      recipientUserId: string;
      module: NotificationModule.TEAMS;
      data: TeamNotificationData;
    })
  | (NotificationPayloadBase & {
      recipientUserId: string;
      module: NotificationModule.CONNECTIONS;
      data: ConnectionNotificationData;
    })
  | (NotificationPayloadBase & {
      recipientUserId: string;
      module: NotificationModule.WITHDRAWALS;
      data: WithdrawalNotificationData;
    })
  | (NotificationPayloadBase & {
      recipientUserId: string;
      module: NotificationModule.TURF_APPROVAL;
      data: TurfApprovalNotificationData;
    });

export type NotificationBaseDto = Omit<
  CreateNotificationInput,
  'recipientUserId'
>;
