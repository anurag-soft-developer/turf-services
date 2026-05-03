import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { config } from '../core/config/env.config';
import { UsersService } from '../users/users.service';
import { FcmService } from './fcm.service';
import type {
  CreateNotificationDto,
  ListNotificationsQueryDto,
} from './dto/notification.dto';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';
import { buildPushDataStrings } from './utility/fcm.utility';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly usersService: UsersService,
    private readonly fcmService: FcmService,
  ) {}

  /**
   * Persists the notification, pushes to realtime WebSocket, then may send FCM
   * when `notificationsEnabled` and `notificationModules[module]` allow device push.
   */
  async createAndDispatch(dto: CreateNotificationDto): Promise<{
    notification: NotificationDocument;
    fcm?: { successCount: number; failureCount: number };
    realtimeDispatched: boolean;
  }> {
    const doc = await this.notificationModel.create(dto);

    const mergedDataStrings = buildPushDataStrings(doc);

    const realtimeDispatched = await this.dispatchToRealtime(doc);

    let fcm: { successCount: number; failureCount: number } | undefined;
    const user = await this.usersService.findByIdWithNotificationPrefs(
      dto.recipientUserId,
    );
    if (
      user &&
      user.notificationsEnabled !== false &&
      user.notificationModules?.[dto.module] !== false &&
      this.fcmService.isReady() &&
      user.fcmTokens?.length
    ) {
      const tokens = user.fcmTokens.map((t) => t.token);
      fcm = await this.fcmService.sendMulticast(
        tokens,
        dto.title,
        dto.body,
        mergedDataStrings,
      );
    }

    return {
      notification: doc,
      fcm,
      realtimeDispatched,
    };
  }

  async listForUser(userId: string, query: ListNotificationsQueryDto) {
    const filter: Record<string, unknown> = { recipientUserId: userId };
    if (query.unreadOnly) {
      filter.readAt = { $exists: false };
    }
    if (query.module) {
      filter.module = query.module;
    }

    const skip = (query.page - 1) * query.limit;
    const [docs, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.limit)
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);

    return {
      data: docs,
      totalDocuments: total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit) || 1,
    };
  }

  async getOneForUser(
    userId: string,
    notificationId: string,
  ): Promise<NotificationDocument> {
    const doc = await this.notificationModel
      .findOne({
        _id: notificationId,
        recipientUserId: userId,
      })
      .exec();
    if (!doc) {
      throw new NotFoundException('Notification not found');
    }
    return doc;
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationDocument> {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new BadRequestException('Invalid notification id');
    }
    const doc = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(notificationId),
          recipientUserId: userId,
        },
        { readAt: new Date() },
        { new: true },
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Notification not found');
    }
    return doc;
  }

  async markAllRead(userId: string): Promise<{ updatedCount: number }> {
    const result = await this.notificationModel.updateMany(
      {
        recipientUserId: userId,
        readAt: { $exists: false },
      },
      { readAt: new Date() },
    );
    return { updatedCount: result.modifiedCount };
  }

  async deleteForUser(
    userId: string,
    notificationId: string,
  ): Promise<{ deleted: true }> {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new BadRequestException('Invalid notification id');
    }
    const result = await this.notificationModel.deleteOne({
      _id: new Types.ObjectId(notificationId),
      recipientUserId: userId,
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Notification not found');
    }
    return { deleted: true };
  }

  async deleteAllForUser(userId: string): Promise<{ deletedCount: number }> {
    const result = await this.notificationModel.deleteMany({
      recipientUserId: userId,
    });
    return { deletedCount: result.deletedCount };
  }

  private async dispatchToRealtime(
    payload: NotificationDocument,
  ): Promise<boolean> {
    const base = config.REALTIME_TURF_BASE_URL?.replace(/\/$/, '');
    const token = config.NOTIFICATION_INTERNAL_TOKEN;
    if (!base || !token) {
      this.logger.warn(
        'Realtime dispatch skipped: REALTIME_TURF_BASE_URL or NOTIFICATION_INTERNAL_TOKEN not set',
      );
      return false;
    }
    try {
      const res = await fetch(`${base}/internal/notifications/dispatch`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify(payload.toObject()),
      });
      if (!res.ok) {
        this.logger.warn(
          `Realtime notification dispatch failed: HTTP ${res.status}`,
        );
      }
      return res.ok;
    } catch (e) {
      this.logger.warn('Realtime notification dispatch error', e as Error);
      return false;
    }
  }
}
