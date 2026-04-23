import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Model, QueryFilter } from 'mongoose';
import {
  SlotHoldStatus,
  TurfBookingStatus,
} from '../interfaces/turf-booking.interface';
import { TurfBookingDocument } from '../schemas/turf-booking.schema';
import { TurfDocument } from '../../turf/schemas/turf.schema';

export class TurfBookingUtility {
  private static readonly PAYMENT_HOLD_MINUTES = 10;

  static getPaymentExpiryDate(): Date {
    const now = new Date();
    now.setMinutes(now.getMinutes() + TurfBookingUtility.PAYMENT_HOLD_MINUTES);
    return now;
  }

  static generateInvoiceId(bookingId: string): string {
    const now = new Date();
    const datePrefix = `${now.getFullYear()}${`${now.getMonth() + 1}`.padStart(
      2,
      '0',
    )}${`${now.getDate()}`.padStart(2, '0')}`;
    return `INV-${datePrefix}-${bookingId.slice(-6).toUpperCase()}`;
  }

  static buildActiveBookingFilter(): QueryFilter<TurfBookingDocument> {
    const now = new Date();

    return {
      $or: [
        {
          status: TurfBookingStatus.CONFIRMED,
        },
        {
          status: TurfBookingStatus.PENDING,
          slotHoldStatus: SlotHoldStatus.ACTIVE,
          paymentExpiresAt: { $gt: now },
        },
      ],
    };
  }

  static calculateBookingAmount(
    turf: TurfDocument,
    startTime: Date,
    endTime: Date,
  ): number {
    const durationHours =
      (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

    let baseAmount = turf.pricing.basePricePerHour * durationHours;
    const dayOfWeek = startTime.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (isWeekend && turf.pricing.weekendSurge > 0) {
      const surgeAmount = baseAmount * (turf.pricing.weekendSurge / 100);
      baseAmount += surgeAmount;
    }

    return Math.round(baseAmount * 100) / 100;
  }

  static async calculateMultiSlotBookingAmount(
    turf: TurfDocument,
    timeSlots: { startTime: Date; endTime: Date }[],
  ): Promise<number> {
    let totalAmount = 0;

    for (const slot of timeSlots) {
      const slotAmount = TurfBookingUtility.calculateBookingAmount(
        turf,
        slot.startTime,
        slot.endTime,
      );
      totalAmount += slotAmount;
    }

    return Math.round(totalAmount * 100) / 100;
  }

  static async checkSingleTimeSlotAvailability(
    turfBookingModel: Model<TurfBookingDocument>,
    checkDto: {
      turf: string;
      startTime: string;
      endTime: string;
      excludeBookingId?: string | null;
    },
  ): Promise<boolean> {
    const {
      turf,
      startTime: startTimeStr,
      endTime: endTimeStr,
      excludeBookingId,
    } = checkDto;

    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);

    const overlapQuery: QueryFilter<TurfBookingDocument> = {
      turf,
      ...TurfBookingUtility.buildActiveBookingFilter(),
      timeSlots: {
        $elemMatch: {
          $or: [
            { startTime: { $lte: startTime }, endTime: { $gt: startTime } },
            { startTime: { $lt: endTime }, endTime: { $gte: endTime } },
            { startTime: { $gte: startTime }, endTime: { $lte: endTime } },
            { startTime: { $lte: startTime }, endTime: { $gte: endTime } },
          ],
        },
      },
    };

    if (excludeBookingId) {
      overlapQuery._id = { $ne: excludeBookingId };
    }

    const conflictingBooking = await turfBookingModel.findOne(overlapQuery);

    if (conflictingBooking) {
      const conflictingSlot = conflictingBooking.timeSlots.find((slot) => {
        const slotStart = new Date(slot.startTime);
        const slotEnd = new Date(slot.endTime);
        return (
          (slotStart <= startTime && slotEnd > startTime) ||
          (slotStart < endTime && slotEnd >= endTime) ||
          (slotStart >= startTime && slotEnd <= endTime) ||
          (slotStart <= startTime && slotEnd >= endTime)
        );
      });

      const conflictDetails = conflictingSlot
        ? `from ${new Date(conflictingSlot.startTime).toISOString()} to ${new Date(conflictingSlot.endTime).toISOString()}`
        : 'with existing booking';

      throw new ConflictException(
        `Time slot conflicts with existing booking ${conflictDetails}`,
      );
    }

    return true;
  }

  static async validateBookingTime(
    turfBookingModel: Model<TurfBookingDocument>,
    startTime: Date,
    endTime: Date,
    turfId: string,
    turf: TurfDocument,
  ): Promise<void> {
    if (startTime >= endTime) {
      throw new BadRequestException('End time must be after start time');
    }

    const durationMs = endTime.getTime() - startTime.getTime();
    const minDurationMs = 60 * 60 * 1000;
    if (durationMs < minDurationMs) {
      throw new BadRequestException('Minimum booking duration is 1 hour');
    }

    const maxDurationMs = 8 * 60 * 60 * 1000;
    if (durationMs > maxDurationMs) {
      throw new BadRequestException('Maximum booking duration is 8 hours');
    }

    const { operatingHours } = turf;
    if (operatingHours.open && operatingHours.close) {
      const bookingStart = new Date(startTime);
      const bookingEnd = new Date(endTime);

      const [openHour, openMin] = operatingHours.open.split(':').map(Number);
      const [closeHour, closeMin] = operatingHours.close.split(':').map(Number);

      const openTime = new Date(bookingStart);
      openTime.setHours(openHour, openMin, 0, 0);

      const closeTime = new Date(bookingStart);
      closeTime.setHours(closeHour, closeMin, 0, 0);

      if (closeTime <= openTime) {
        closeTime.setDate(closeTime.getDate() + 1);
      }

      if (bookingStart < openTime || bookingEnd > closeTime) {
        throw new BadRequestException(
          `Booking must be within operating hours: ${operatingHours.open} - ${operatingHours.close}`,
        );
      }
    }

    const bufferMs = turf.slotBufferMins * 60 * 1000;
    const bufferQuery = {
      turf: turfId,
      ...TurfBookingUtility.buildActiveBookingFilter(),
      timeSlots: {
        $elemMatch: {
          $or: [
            {
              endTime: {
                $gt: new Date(startTime.getTime() - bufferMs),
                $lte: startTime,
              },
            },
            {
              startTime: {
                $gte: endTime,
                $lt: new Date(endTime.getTime() + bufferMs),
              },
            },
          ],
        },
      },
    };

    const conflictingBooking = await turfBookingModel.findOne(bufferQuery);
    if (conflictingBooking) {
      throw new ConflictException(
        `Booking conflicts with buffer time requirements. Minimum ${turf.slotBufferMins} minutes gap required between bookings.`,
      );
    }
  }

  static validateStatusTransition(
    currentStatus: TurfBookingStatus,
    newStatus: TurfBookingStatus,
  ): void {
    const isValidTransition = TurfBookingUtility.isValidStatusTransition(
      currentStatus,
      newStatus,
    );
    if (!isValidTransition) {
      throw new BadRequestException(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
      );
    }
  }

  static isValidStatusTransition(
    currentStatus: TurfBookingStatus,
    newStatus: TurfBookingStatus,
  ): boolean {
    const validTransitions: Record<TurfBookingStatus, TurfBookingStatus[]> = {
      [TurfBookingStatus.PENDING]: [
        TurfBookingStatus.CONFIRMED,
        TurfBookingStatus.CANCELLED,
      ],
      [TurfBookingStatus.CONFIRMED]: [
        TurfBookingStatus.COMPLETED,
        TurfBookingStatus.CANCELLED,
      ],
      [TurfBookingStatus.CANCELLED]: [],
      [TurfBookingStatus.COMPLETED]: [],
    };

    return validTransitions[currentStatus].includes(newStatus);
  }
}
