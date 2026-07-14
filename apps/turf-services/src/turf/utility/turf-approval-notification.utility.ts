import { Logger } from '@nestjs/common';
import { dispatchToUsers } from '../../notification/utility/notification-dispatch.utility';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../auth/decorators/roles.decorator';
import type { TurfDocument } from '../schemas/turf.schema';

const logger = new Logger('TurfApprovalNotification');

export async function notifyTurfSubmittedForApproval(
  notificationService: NotificationService,
  usersService: UsersService,
  turf: TurfDocument,
  ownerId: string,
): Promise<void> {
  try {
    const adminIds = await usersService.findIdsByRoles([
      UserRole.ADMIN,
      UserRole.PLATFORM_ADMIN,
    ]);
    await dispatchToUsers(notificationService, adminIds, {
      module: NotificationModule.TURF_APPROVAL,
      title: 'Turf pending review',
      body: `${turf.name} was submitted for approval.`,
      data: {
        kind: 'turf_submitted',
        turfId: turf._id.toString(),
        actorUserId: ownerId,
      },
      sourceType: 'turf',
      sourceId: turf._id.toString(),
    });
  } catch (err) {
    logger.warn(
      `notifyTurfSubmittedForApproval failed for turf ${turf._id.toString()}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyTurfReviewed(
  notificationService: NotificationService,
  turf: TurfDocument,
  published: boolean,
  rejectionReason?: string,
): Promise<void> {
  try {
    const body = published
      ? `Your turf "${turf.name}" was published.`
      : `Your turf "${turf.name}" was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`;

    await notificationService.createAndDispatch({
      recipientUserId: turf.postedBy.toString(),
      module: NotificationModule.TURF_APPROVAL,
      title: published ? 'Turf published' : 'Turf rejected',
      body,
      data: {
        kind: published ? 'turf_published' : 'turf_rejected',
        turfId: turf._id.toString(),
        ...(rejectionReason ? { rejectionReason } : {}),
      },
      sourceType: 'turf',
      sourceId: turf._id.toString(),
    });
  } catch (err) {
    logger.warn(
      `notifyTurfReviewed failed for turf ${turf._id.toString()}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
