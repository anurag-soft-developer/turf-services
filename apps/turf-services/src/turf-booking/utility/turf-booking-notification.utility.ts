import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import type { TurfDocument } from '../../turf/schemas/turf.schema';
import type { TurfBookingDocument } from '../schemas/turf-booking.schema';

const logger = new Logger('TurfBookingNotification');

async function loadTurfName(
  turfModel: Model<TurfDocument>,
  turfId: unknown,
): Promise<{ name: string; postedBy: string } | null> {
  const turf = await turfModel.findById(turfId).select('name postedBy').lean();
  if (!turf) {
    return null;
  }
  return { name: turf.name, postedBy: turf.postedBy.toString() };
}

/**
 * Notifies the turf owner after a customer's payment is verified (booking confirmed).
 */
export async function notifyOwnerNewPaidBooking(
  notificationService: NotificationService,
  turfModel: Model<TurfDocument>,
  booking: TurfBookingDocument,
): Promise<void> {
  const bookingId = booking._id.toString();
  try {
    const turf = await loadTurfName(turfModel, booking.turf);
    if (!turf) {
      return;
    }

    await notificationService.createAndDispatch({
      recipientUserId: turf.postedBy,
      module: NotificationModule.TURF_BOOKING,
      title: 'New booking',
      body: `You have a new confirmed booking at ${turf.name}.`,
      data: {
        bookingId,
        kind: 'booking_paid',
      },
      sourceType: 'turfBooking',
      sourceId: bookingId,
    });
  } catch (err) {
    logger.warn(
      `notifyOwnerNewPaidBooking failed for booking ${bookingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

/**
 * Notifies the booker after payment is verified (booking confirmed).
 */
export async function notifyBookerBookingConfirmed(
  notificationService: NotificationService,
  turfModel: Model<TurfDocument>,
  booking: TurfBookingDocument,
): Promise<void> {
  const bookingId = booking._id.toString();
  try {
    const turf = await loadTurfName(turfModel, booking.turf);
    if (!turf) {
      return;
    }

    await notificationService.createAndDispatch({
      recipientUserId: booking.bookedBy.toString(),
      module: NotificationModule.TURF_BOOKING,
      title: 'Booking confirmed',
      body: `Your booking at ${turf.name} is confirmed.`,
      data: {
        bookingId,
        kind: 'booking_confirmed',
      },
      sourceType: 'turfBooking',
      sourceId: bookingId,
    });
  } catch (err) {
    logger.warn(
      `notifyBookerBookingConfirmed failed for booking ${bookingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

/**
 * Notifies owner and booker after a booking is confirmed (paid).
 */
export async function notifyTurfBookingConfirmedParties(
  notificationService: NotificationService,
  turfModel: Model<TurfDocument>,
  booking: TurfBookingDocument,
): Promise<void> {
  await Promise.all([
    notifyOwnerNewPaidBooking(notificationService, turfModel, booking),
    notifyBookerBookingConfirmed(notificationService, turfModel, booking),
  ]);
}

/**
 * Notifies the booker when payment fails or the hold expires.
 */
export async function notifyBookerPaymentFailed(
  notificationService: NotificationService,
  booking: TurfBookingDocument,
  turfName: string,
  reason: 'payment_failed' | 'hold_expired',
): Promise<void> {
  const bookingId = booking._id.toString();
  try {
    const body =
      reason === 'hold_expired'
        ? `Your booking hold at ${turfName} expired. Please create a new booking.`
        : `Payment for your booking at ${turfName} failed. The booking was cancelled.`;

    await notificationService.createAndDispatch({
      recipientUserId: booking.bookedBy.toString(),
      module: NotificationModule.TURF_BOOKING,
      title:
        reason === 'hold_expired' ? 'Booking hold expired' : 'Payment failed',
      body,
      data: {
        bookingId,
        kind:
          reason === 'hold_expired' ? 'booking_hold_expired' : 'payment_failed',
      },
      sourceType: 'turfBooking',
      sourceId: bookingId,
    });
  } catch (err) {
    logger.warn(
      `notifyBookerPaymentFailed failed for booking ${bookingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

/**
 * Notifies the other party when a booking is cancelled (owner ↔ booker).
 */
export async function notifyBookingCancelledParty(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    bookingId: string;
    turfName: string;
    cancelledBy: 'owner' | 'booker';
  },
): Promise<void> {
  try {
    const body =
      params.cancelledBy === 'owner'
        ? `Your booking at ${params.turfName} was cancelled by the turf owner.`
        : `A booking at ${params.turfName} was cancelled by the customer.`;

    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.TURF_BOOKING,
      title: 'Booking cancelled',
      body,
      data: {
        bookingId: params.bookingId,
        kind: 'booking_cancelled',
        cancelledBy: params.cancelledBy,
      },
      sourceType: 'turfBooking',
      sourceId: params.bookingId,
    });
  } catch (err) {
    logger.warn(
      `notifyBookingCancelledParty failed for booking ${params.bookingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
