import { Logger } from '@nestjs/common';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';

const logger = new Logger('ConnectionsNotification');

export async function notifyConnectionRequest(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    connectionId: string;
    requesterUserId: string;
  },
): Promise<void> {
  try {
    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.CONNECTIONS,
      title: 'Connection request',
      body: 'You have a new connection request.',
      data: {
        kind: 'connection_request',
        connectionId: params.connectionId,
        actorUserId: params.requesterUserId,
      },
      sourceType: 'connection',
      sourceId: params.connectionId,
    });
  } catch (err) {
    logger.warn(
      `notifyConnectionRequest failed for connection ${params.connectionId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyConnectionResolved(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    connectionId: string;
    accepted: boolean;
  },
): Promise<void> {
  try {
    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.CONNECTIONS,
      title: params.accepted ? 'Connection accepted' : 'Connection declined',
      body: params.accepted
        ? 'Your connection request was accepted.'
        : 'Your connection request was declined.',
      data: {
        kind: params.accepted ? 'connection_accepted' : 'connection_rejected',
        connectionId: params.connectionId,
      },
      sourceType: 'connection',
      sourceId: params.connectionId,
    });
  } catch (err) {
    logger.warn(
      `notifyConnectionResolved failed for connection ${params.connectionId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
