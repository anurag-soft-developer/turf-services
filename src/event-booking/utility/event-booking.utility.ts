import { BadRequestException } from '@nestjs/common';
import { EventBookingStatus } from '../interfaces/event-booking.interface';

export class EventBookingUtility {
  private static readonly PAYMENT_HOLD_MINUTES = 10;

  static getPaymentExpiryDate(): Date {
    const now = new Date();
    now.setMinutes(
      now.getMinutes() + EventBookingUtility.PAYMENT_HOLD_MINUTES,
    );
    return now;
  }

  static generateInvoiceId(bookingId: string): string {
    const now = new Date();
    const datePrefix = `${now.getFullYear()}${`${now.getMonth() + 1}`.padStart(
      2,
      '0',
    )}${`${now.getDate()}`.padStart(2, '0')}`;
    return `EVT-${datePrefix}-${bookingId.slice(-6).toUpperCase()}`;
  }

  private static readonly statusTransitions: Record<
    EventBookingStatus,
    EventBookingStatus[]
  > = {
    [EventBookingStatus.PENDING]: [
      EventBookingStatus.CONFIRMED,
      EventBookingStatus.CANCELLED,
    ],
    [EventBookingStatus.CONFIRMED]: [
      EventBookingStatus.COMPLETED,
      EventBookingStatus.CANCELLED,
    ],
    [EventBookingStatus.CANCELLED]: [],
    [EventBookingStatus.COMPLETED]: [],
  };

  static validateStatusTransition(
    current: EventBookingStatus,
    next: EventBookingStatus,
  ): void {
    if (current === next) {
      return;
    }
    if (!EventBookingUtility.statusTransitions[current].includes(next)) {
      throw new BadRequestException(
        `Invalid booking status transition from ${current} to ${next}`,
      );
    }
  }
}
