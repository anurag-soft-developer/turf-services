import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model } from 'mongoose';
import {
  EventBookingStatus,
  PaymentStatus,
} from '../interfaces/event-booking.interface';
import { EventBookingDocument } from '../schemas/event-booking.schema';
import { EventDocument } from '../../events/schemas/event.schema';
import { RajorpayService } from '../../core/services/rajorpay/rajorpay.service';
import { WalletService } from '../../wallet/wallet.service';
import { WalletType } from '../../wallet/interfaces/wallet.interface';
import { EventsService } from '../../events/events.service';
import { UserRole } from '../../auth/decorators/roles.decorator';
import { resolveId } from '../../core/utils/mongo-ref.util';
import * as UserInterface from '../../users/interfaces/user.interface';

export class EventBookingUtility {
  private static readonly PAYMENT_HOLD_MINUTES = 10;

  static getPaymentExpiryDate(): Date {
    const now = new Date();
    now.setMinutes(now.getMinutes() + EventBookingUtility.PAYMENT_HOLD_MINUTES);
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

  static async confirmPaidBookingFromPaymentLink(
    eventBookingModel: Model<EventBookingDocument>,
    eventModel: Model<EventDocument>,
    rajorpayService: RajorpayService,
    walletService: WalletService,
    eventsService: EventsService,
    booking: EventBookingDocument,
    paymentLinkId: string,
    razorpayPaymentId?: string,
  ): Promise<boolean> {
    if (booking.paymentStatus === PaymentStatus.PAID) {
      return true;
    }

    if (booking.status !== EventBookingStatus.PENDING) {
      return false;
    }

    const resolved =
      await rajorpayService.resolveCapturedPaymentForLink(paymentLinkId);
    if (!resolved) {
      return false;
    }

    const paymentId = razorpayPaymentId ?? resolved.paymentId;
    const event = await eventModel.findById(booking.event);
    if (!event) {
      return false;
    }

    await EventBookingUtility.assertCapacityAvailable(
      eventBookingModel,
      event,
      1,
      booking._id.toString(),
    );

    await EventBookingUtility.confirmPaidBooking(
      walletService,
      eventsService,
      booking,
      event,
      resolved.orderId,
      paymentId,
    );

    return true;
  }

  static async confirmPaidBooking(
    walletService: WalletService,
    eventsService: EventsService,
    booking: EventBookingDocument,
    event: EventDocument,
    orderId: string,
    razorpayPaymentId: string,
  ): Promise<void> {
    if (booking.paymentStatus === PaymentStatus.PAID) {
      return;
    }

    booking.razorpayOrderId = orderId;
    booking.razorpayPaymentId = razorpayPaymentId;
    booking.paymentStatus = PaymentStatus.PAID;
    booking.status = EventBookingStatus.CONFIRMED;
    booking.paymentExpiresAt = undefined;
    booking.confirmedAt = new Date();
    booking.paidAt = new Date();
    booking.bookingId =
      booking.bookingId ||
      EventBookingUtility.generateBookingId(booking._id.toString());
    await booking.save();

    if (booking.organizerPayoutAmount && booking.organizerPayoutAmount > 0) {
      await walletService.moveAmountToEscrow(
        WalletType.EVENT,
        booking._id.toString(),
        event.createdBy.toString(),
        booking.organizerPayoutAmount,
      );
    }

    await eventsService.incrementRegisteredCount(event._id.toString(), 1);
  }

  static async assertCapacityAvailable(
    eventBookingModel: Model<EventBookingDocument>,
    event: EventDocument,
    slots: number,
    excludeBookingId?: string,
  ): Promise<void> {
    const pending = await EventBookingUtility.countActivePendingBookings(
      eventBookingModel,
      event._id.toString(),
      excludeBookingId,
    );
    if (event.registeredCount + pending + slots > event.maxParticipants) {
      throw new BadRequestException('Event is at full capacity');
    }
  }

  static async assertOrganizerAccess(
    eventModel: Model<EventDocument>,
    eventId: string,
    userId: string,
    userRole: string,
  ): Promise<void> {
    if (userRole === UserRole.PLATFORM_ADMIN) {
      return;
    }

    const event = await eventModel.findById(eventId).select('createdBy');
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (resolveId(event.createdBy) !== resolveId(userId)) {
      throw new ForbiddenException('Access denied');
    }
  }

  static async countActivePendingBookings(
    eventBookingModel: Model<EventBookingDocument>,
    eventId: string,
    excludeBookingId?: string,
  ): Promise<number> {
    const now = new Date();
    return eventBookingModel.countDocuments({
      event: eventId,
      status: EventBookingStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      paymentExpiresAt: { $gt: now },
      ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
    });
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
