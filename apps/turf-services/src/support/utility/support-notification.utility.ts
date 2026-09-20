import { Logger } from '@nestjs/common';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import { SupportQueryStatus } from '../interfaces/support.interface';

const logger = new Logger('SupportNotification');

function preview(text: string, max: number): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}…`;
}

export async function notifySupportAdminReply(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    queryId: string;
    subject: string;
    replyBody: string;
  },
): Promise<void> {
  try {
    const snippet = preview(params.replyBody, 140);
    const subjectPreview = preview(params.subject, 80);
    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.SUPPORT,
      title: 'Support replied',
      body: snippet
        ? `${subjectPreview}: ${snippet}`
        : `Support replied to "${subjectPreview}".`,
      data: {
        kind: 'support_replied',
        queryId: params.queryId,
      },
      sourceType: 'support_query',
      sourceId: params.queryId,
    });
  } catch (err) {
    logger.warn(
      `notifySupportAdminReply failed for query ${params.queryId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifySupportStatusChanged(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    queryId: string;
    subject: string;
    status: SupportQueryStatus;
  },
): Promise<void> {
  try {
    const subjectPreview = preview(params.subject, 80);
    const resolved = params.status === SupportQueryStatus.RESOLVED;
    const body =
      params.status === SupportQueryStatus.RESOLVED
        ? `Your query "${subjectPreview}" was marked resolved.`
        : params.status === SupportQueryStatus.IN_PROGRESS
          ? `Your query "${subjectPreview}" is now in progress.`
          : `Your query "${subjectPreview}" was reopened.`;

    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.SUPPORT,
      title: resolved ? 'Query resolved' : 'Query update',
      body,
      data: {
        kind: 'support_status_changed',
        queryId: params.queryId,
        status: params.status,
      },
      sourceType: 'support_query',
      sourceId: params.queryId,
    });
  } catch (err) {
    logger.warn(
      `notifySupportStatusChanged failed for query ${params.queryId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
