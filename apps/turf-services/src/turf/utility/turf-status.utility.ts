import { BadRequestException } from '@nestjs/common';
import { TurfStatus } from '../schemas/turf.schema';

const transitionMap: Record<TurfStatus, TurfStatus[]> = {
  [TurfStatus.DRAFT]: [TurfStatus.PENDING_APPROVAL],
  [TurfStatus.PENDING_APPROVAL]: [
    TurfStatus.PUBLISHED,
    TurfStatus.REJECTED,
    TurfStatus.DRAFT,
  ],
  [TurfStatus.PUBLISHED]: [],
  [TurfStatus.REJECTED]: [TurfStatus.PENDING_APPROVAL],
};

export class TurfStatusUtility {
  static validateTransition(
    currentStatus: TurfStatus,
    nextStatus: TurfStatus,
  ): void {
    if (currentStatus === nextStatus) {
      return;
    }

    if (!transitionMap[currentStatus].includes(nextStatus)) {
      throw new BadRequestException(
        `Invalid turf status transition from ${currentStatus} to ${nextStatus}`,
      );
    }
  }
}
