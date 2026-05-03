import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import type { TurfDocument } from '../../turf/schemas/turf.schema';
import type { TurfBookingDocument } from '../schemas/turf-booking.schema';

const logger = new Logger('TurfBookingNotification');

/**
 * Notifies the turf owner after a customer’s payment is verified (booking confirmed).
 * Loads the turf from `booking.turf` to resolve owner and name.
 */
export async function notifyOwnerNewPaidBooking(
  notificationService: NotificationService,
  turfModel: Model<TurfDocument>,
  booking: TurfBookingDocument,
): Promise<void> {
  const bookingId = booking._id.toString();
  try {
    const turf = await turfModel.findById(booking.turf);
    if (!turf) {
      return;
    }

    await notificationService.createAndDispatch({
      recipientUserId: turf.postedBy.toString(),
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
