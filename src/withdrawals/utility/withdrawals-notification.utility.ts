import { Logger } from '@nestjs/common';
import { dispatchToUsers } from '../../notification/utility/notification-dispatch.utility';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../auth/decorators/roles.decorator';
import { WithdrawalStatus } from '../interfaces/withdrawal.interface';

const logger = new Logger('WithdrawalsNotification');

const HOST_NOTIFY_STATUSES = new Set<WithdrawalStatus>([
  WithdrawalStatus.APPROVED,
  WithdrawalStatus.REJECTED,
  WithdrawalStatus.PROCESSING,
  WithdrawalStatus.SETTLED,
]);

export async function notifyWithdrawalSubmitted(
  notificationService: NotificationService,
  usersService: UsersService,
  params: {
    withdrawalId: string;
    amount: number;
    walletType: string;
    hostUserId: string;
  },
): Promise<void> {
  try {
    const adminIds = await usersService.findIdsByRoles([
      UserRole.ADMIN,
      UserRole.PLATFORM_ADMIN,
    ]);
    await dispatchToUsers(notificationService, adminIds, {
      module: NotificationModule.WITHDRAWALS,
      title: 'Withdrawal request',
      body: `A new withdrawal request of ${params.amount} was submitted.`,
      data: {
        kind: 'withdrawal_submitted',
        withdrawalId: params.withdrawalId,
        amount: params.amount,
        walletType: params.walletType,
        actorUserId: params.hostUserId,
      },
      sourceType: 'withdrawal',
      sourceId: params.withdrawalId,
    });
  } catch (err) {
    logger.warn(
      `notifyWithdrawalSubmitted failed for withdrawal ${params.withdrawalId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyWithdrawalStatusChanged(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    withdrawalId: string;
    status: WithdrawalStatus;
    amount: number;
    walletType: string;
    rejectionReason?: string;
  },
): Promise<void> {
  if (!HOST_NOTIFY_STATUSES.has(params.status)) {
    return;
  }

  try {
    const statusLabel = params.status.replace(/_/g, ' ');
    const body =
      params.status === WithdrawalStatus.REJECTED && params.rejectionReason
        ? `Your withdrawal request was rejected: ${params.rejectionReason}`
        : `Your withdrawal request is now ${statusLabel}.`;

    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.WITHDRAWALS,
      title: 'Withdrawal update',
      body,
      data: {
        kind: 'withdrawal_status_changed',
        withdrawalId: params.withdrawalId,
        status: params.status,
        amount: params.amount,
        walletType: params.walletType,
        ...(params.rejectionReason ? { rejectionReason: params.rejectionReason } : {}),
      },
      sourceType: 'withdrawal',
      sourceId: params.withdrawalId,
    });
  } catch (err) {
    logger.warn(
      `notifyWithdrawalStatusChanged failed for withdrawal ${params.withdrawalId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
