import { BadRequestException } from '@nestjs/common';
import { EventStatus } from '../interfaces/event.interface';

const transitionMap: Record<EventStatus, EventStatus[]> = {
  [EventStatus.DRAFT]: [EventStatus.PENDING_APPROVAL],
  [EventStatus.PENDING_APPROVAL]: [
    EventStatus.PUBLISHED,
    EventStatus.REJECTED,
    EventStatus.DRAFT,
  ],
  [EventStatus.PUBLISHED]: [EventStatus.CLOSED],
  [EventStatus.REJECTED]: [EventStatus.PENDING_APPROVAL],
  [EventStatus.CLOSED]: [],
};

export class EventStatusUtility {
  static validateTransition(
    currentStatus: EventStatus,
    nextStatus: EventStatus,
  ): void {
    if (currentStatus === nextStatus) {
      return;
    }

    if (!transitionMap[currentStatus].includes(nextStatus)) {
      throw new BadRequestException(
        `Invalid event status transition from ${currentStatus} to ${nextStatus}`,
      );
    }
  }
}
