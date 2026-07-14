import { BadRequestException } from '@nestjs/common';
import { WithdrawalStatus } from '../interfaces/withdrawal.interface';

const transitionMap: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  [WithdrawalStatus.PENDING]: [
    WithdrawalStatus.APPROVED,
    WithdrawalStatus.REJECTED,
    WithdrawalStatus.CANCELLED,
  ],
  [WithdrawalStatus.APPROVED]: [
    WithdrawalStatus.PROCESSING,
    WithdrawalStatus.REJECTED,
    WithdrawalStatus.CANCELLED,
  ],
  [WithdrawalStatus.PROCESSING]: [
    WithdrawalStatus.SETTLED,
    WithdrawalStatus.REJECTED,
  ],
  [WithdrawalStatus.REJECTED]: [],
  [WithdrawalStatus.SETTLED]: [],
  [WithdrawalStatus.CANCELLED]: [],
};

export class WithdrawalUtility {
  static validateStatusTransition(
    currentStatus: WithdrawalStatus,
    nextStatus: WithdrawalStatus,
  ) {
    if (currentStatus === nextStatus) return;

    if (!transitionMap[currentStatus].includes(nextStatus)) {
      throw new BadRequestException(
        `Invalid withdrawal status transition from ${currentStatus} to ${nextStatus}`,
      );
    }
  }

  static isTerminalStatus(status: WithdrawalStatus): boolean {
    return [
      WithdrawalStatus.REJECTED,
      WithdrawalStatus.SETTLED,
      WithdrawalStatus.CANCELLED,
    ].includes(status);
  }
}
