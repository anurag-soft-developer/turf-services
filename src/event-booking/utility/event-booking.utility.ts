import { BadRequestException } from '@nestjs/common';
import { EventBookingStatus } from '../interfaces/event-booking.interface';
import { EventBookingDocument } from '../schemas/event-booking.schema';
import { RajorpayService } from '../../core/services/rajorpay/rajorpay.service';
import * as UserInterface from '../../users/interfaces/user.interface';

export class EventBookingUtility {
  private static readonly PAYMENT_HOLD_MINUTES = 10;

  static getPaymentExpiryDate(): Date {
    const now = new Date();
    now.setMinutes(
      now.getMinutes() + EventBookingUtility.PAYMENT_HOLD_MINUTES,
    );
    return now;
  }

  static isPaymentHoldExpired(booking: EventBookingDocument): boolean {
    return Boolean(
      booking.paymentExpiresAt &&
        new Date(booking.paymentExpiresAt) <= new Date(),
    );
  }

  static generateBookingId(bookingId: string): string {
    const now = new Date();
    const datePrefix = `${now.getFullYear()}${`${now.getMonth() + 1}`.padStart(
      2,
      '0',
    )}${`${now.getDate()}`.padStart(2, '0')}`;
    return `EVT-${datePrefix}-${bookingId.slice(-6).toUpperCase()}`;
  }

  static async resolveOrCreateRazorpayPaymentLink(
    rajorpayService: RajorpayService,
    booking: EventBookingDocument,
    user: UserInterface.IUser,
    eventId: string,
    bookingId: string,
    amountInPaise: number,
    callbackUrl: string,
    expireBy: number,
  ): Promise<{ id: string; shortUrl: string; callbackUrl: string }> {
    if (booking.razorpayPaymentLinkId) {
      const existingLink = await rajorpayService.getPaymentLink(
        booking.razorpayPaymentLinkId,
      );
      if (
        existingLink &&
        rajorpayService.isPaymentLinkReusable(existingLink, amountInPaise)
      ) {
        return {
          id: booking.razorpayPaymentLinkId,
          shortUrl: booking.razorpayPaymentLinkShortUrl!,
          callbackUrl: booking.razorpayPaymentLinkCallbackUrl!,
        };
      }

      booking.razorpayPaymentLinkId = undefined;
      booking.razorpayPaymentLinkShortUrl = undefined;
      booking.razorpayPaymentLinkCallbackUrl = undefined;
    }

    const link = await rajorpayService.createPaymentLink({
      amountInPaise,
      referenceId: `event_booking_${bookingId}`,
      description: 'Event registration payment',
      callbackUrl,
      expireBy,
      customer: {
        name: booking.fullName || user.fullName,
        email: user.email,
        contact: booking.contactNumber || user.phone,
      },
      notes: {
        bookingId,
        eventId,
      },
    });

    booking.razorpayPaymentLinkId = link.id;
    booking.razorpayPaymentLinkShortUrl = link.short_url;
    booking.razorpayPaymentLinkCallbackUrl = callbackUrl;
    await booking.save();

    return {
      id: link.id,
      shortUrl: link.short_url,
      callbackUrl,
    };
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
