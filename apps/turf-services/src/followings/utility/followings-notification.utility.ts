import { Logger } from '@nestjs/common';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';

const logger = new Logger('FollowingsNotification');

export async function notifyFollowingRequest(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    followingId: string;
    requesterUserId: string;
  },
): Promise<void> {
  try {
    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.FOLLOWINGS,
      title: 'Following request',
      body: 'You have a new following request.',
      data: {
        kind: 'following_request',
        followingId: params.followingId,
        actorUserId: params.requesterUserId,
      },
      sourceType: 'following',
      sourceId: params.followingId,
    });
  } catch (err) {
    logger.warn(
      `notifyFollowingRequest failed for following ${params.followingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyFollowingResolved(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    followingId: string;
    accepted: boolean;
  },
): Promise<void> {
  try {
    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.FOLLOWINGS,
      title: params.accepted ? 'Following accepted' : 'Following declined',
      body: params.accepted
        ? 'Your following request was accepted.'
        : 'Your following request was declined.',
      data: {
        kind: params.accepted ? 'following_accepted' : 'following_rejected',
        followingId: params.followingId,
      },
      sourceType: 'following',
      sourceId: params.followingId,
    });
  } catch (err) {
    logger.warn(
      `notifyFollowingResolved failed for following ${params.followingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
