import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import type { EventDocument } from '../../events/schemas/event.schema';
import type { EventBookingDocument } from '../schemas/event-booking.schema';

const logger = new Logger('EventBookingNotification');

async function loadEventTitle(
  eventModel: Model<EventDocument>,
  eventId: unknown,
): Promise<{ title: string; createdBy: string } | null> {
  const event = await eventModel
    .findById(eventId)
    .select('title createdBy')
    .lean();
  if (!event) {
    return null;
  }
  return { title: event.title, createdBy: event.createdBy.toString() };
}

export async function notifyOrganizerNewRegistration(
  notificationService: NotificationService,
  eventModel: Model<EventDocument>,
  booking: EventBookingDocument,
): Promise<void> {
  const bookingId = booking._id.toString();
  try {
    const event = await loadEventTitle(eventModel, booking.event);
    if (!event) {
      return;
    }

    await notificationService.createAndDispatch({
      recipientUserId: event.createdBy,
      module: NotificationModule.EVENT_BOOKING,
      title: 'New registration',
      body: `You have a new confirmed registration for ${event.title}.`,
      data: {
        bookingId,
        eventId: booking.event.toString(),
        kind: 'booking_paid',
      },
      sourceType: 'eventBooking',
      sourceId: bookingId,
    });
  } catch (err) {
    logger.warn(
      `notifyOrganizerNewRegistration failed for booking ${bookingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyBookerEventBookingConfirmed(
  notificationService: NotificationService,
  eventModel: Model<EventDocument>,
  booking: EventBookingDocument,
): Promise<void> {
  const bookingId = booking._id.toString();
  try {
    const event = await loadEventTitle(eventModel, booking.event);
    if (!event) {
      return;
    }

    await notificationService.createAndDispatch({
      recipientUserId: booking.bookedBy.toString(),
      module: NotificationModule.EVENT_BOOKING,
      title: 'Registration confirmed',
      body: `Your registration for ${event.title} is confirmed.`,
      data: {
        bookingId,
        eventId: booking.event.toString(),
        kind: 'booking_confirmed',
      },
      sourceType: 'eventBooking',
      sourceId: bookingId,
    });
  } catch (err) {
    logger.warn(
      `notifyBookerEventBookingConfirmed failed for booking ${bookingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyEventBookingConfirmedParties(
  notificationService: NotificationService,
  eventModel: Model<EventDocument>,
  booking: EventBookingDocument,
): Promise<void> {
  await Promise.all([
    notifyOrganizerNewRegistration(notificationService, eventModel, booking),
    notifyBookerEventBookingConfirmed(notificationService, eventModel, booking),
  ]);
}

export async function notifyBookerEventPaymentFailed(
  notificationService: NotificationService,
  booking: EventBookingDocument,
  eventTitle: string,
  reason: 'payment_failed' | 'hold_expired',
): Promise<void> {
  const bookingId = booking._id.toString();
  try {
    const body =
      reason === 'hold_expired'
        ? `Your registration hold for ${eventTitle} expired. Please create a new booking.`
        : `Payment for your registration at ${eventTitle} failed. The booking was cancelled.`;

    await notificationService.createAndDispatch({
      recipientUserId: booking.bookedBy.toString(),
      module: NotificationModule.EVENT_BOOKING,
      title:
        reason === 'hold_expired'
          ? 'Registration hold expired'
          : 'Payment failed',
      body,
      data: {
        bookingId,
        eventId: booking.event.toString(),
        kind:
          reason === 'hold_expired' ? 'booking_hold_expired' : 'payment_failed',
      },
      sourceType: 'eventBooking',
      sourceId: bookingId,
    });
  } catch (err) {
    logger.warn(
      `notifyBookerEventPaymentFailed failed for booking ${bookingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyEventBookingCancelledParty(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    bookingId: string;
    eventId: string;
    eventTitle: string;
    cancelledBy: 'organizer' | 'booker';
  },
): Promise<void> {
  try {
    const body =
      params.cancelledBy === 'organizer'
        ? `Your registration for ${params.eventTitle} was cancelled by the organizer.`
        : `A registration for ${params.eventTitle} was cancelled by the participant.`;

    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.EVENT_BOOKING,
      title: 'Registration cancelled',
      body,
      data: {
        bookingId: params.bookingId,
        eventId: params.eventId,
        kind: 'booking_cancelled',
        cancelledBy: params.cancelledBy,
      },
      sourceType: 'eventBooking',
      sourceId: params.bookingId,
    });
  } catch (err) {
    logger.warn(
      `notifyEventBookingCancelledParty failed for booking ${params.bookingId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
