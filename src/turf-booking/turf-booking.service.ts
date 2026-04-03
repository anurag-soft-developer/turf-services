import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PopulateOptions, QueryFilter } from 'mongoose';
import {
  TurfBooking,
  TurfBookingDocument,
} from './schemas/turf-booking.schema';
import {
  turfSelectFields,
  Turf,
  TurfDocument,
} from '../turf/schemas/turf.schema';
import {
  CreateTurfBookingDto,
  UpdateTurfBookingDto,
  TurfBookingFilterDto,
  CheckTurfAvailabilityDto,
} from './dto/turf-booking.dto';
import {
  TurfBookingStatus,
  PaymentStatus,
} from './interfaces/turf-booking.interface';
import { PaginatedResult } from '../core/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';

@Injectable()
export class TurfBookingService {
  static populateOptions: PopulateOptions[] = [
    {
      path: 'turf',
      select: turfSelectFields,
    },
    {
      path: 'bookedBy',
      select: userSelectFields,
    },
  ];

  constructor(
    @InjectModel(TurfBooking.name)
    private turfBookingModel: Model<TurfBookingDocument>,
    @InjectModel(Turf.name)
    private turfModel: Model<TurfDocument>,
  ) {}

  async createBooking(
    createBookingDto: CreateTurfBookingDto,
    userId: string,
  ): Promise<TurfBookingDocument> {
    const { turf, timeSlots, playerCount, notes } = createBookingDto;

    // Convert time slots to Date objects
    const processedTimeSlots = timeSlots.map((slot) => ({
      startTime: new Date(slot.startTime),
      endTime: new Date(slot.endTime),
    }));

    // Check if turf exists and is available
    const turfDoc = await this.turfModel.findById(turf);
    if (!turfDoc) {
      throw new NotFoundException('Turf not found');
    }

    if (!turfDoc.isAvailable) {
      throw new BadRequestException('Turf is not available for booking');
    }

    // Sort time slots by start time to ensure they don't overlap
    processedTimeSlots.sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );

    // Validate each time slot and check for overlaps between them
    for (let i = 0; i < processedTimeSlots.length; i++) {
      const currentSlot = processedTimeSlots[i];

      // Validate individual slot
      await this.validateBookingTime(
        currentSlot.startTime,
        currentSlot.endTime,
        turf,
        turfDoc,
      );

      // Check for overlaps with other slots in the same booking
      if (i > 0) {
        const previousSlot = processedTimeSlots[i - 1];
        if (currentSlot.startTime < previousSlot.endTime) {
          throw new BadRequestException(
            `Time slots cannot overlap. Slot starting at ${currentSlot.startTime.toISOString()} overlaps with previous slot ending at ${previousSlot.endTime.toISOString()}`,
          );
        }
      }

      // Check for conflicts with existing bookings
      await this.checkSingleTimeSlotAvailability({
        turf,
        startTime: currentSlot.startTime.toISOString(),
        endTime: currentSlot.endTime.toISOString(),
      });
    }

    // Calculate total amount for all time slots
    const totalAmount = await this.calculateMultiSlotBookingAmount(
      turfDoc,
      processedTimeSlots,
    );

    // Create the booking
    const booking = new this.turfBookingModel({
      turf,
      bookedBy: userId,
      timeSlots: processedTimeSlots,
      playerCount,
      notes,
      totalAmount,
      status: TurfBookingStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
    });

    return await (
      await booking.save()
    ).populate(TurfBookingService.populateOptions);
  }

  async updateBooking(
    bookingId: string,
    updateBookingDto: UpdateTurfBookingDto & {
      cancelledAt?: Date;
      confirmedAt?: Date;
      totalAmount?: number;
    },
    userId: string,
  ): Promise<TurfBookingDocument> {
    const booking = await this.turfBookingModel.findById(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Check if user is the booker or turf owner
    const turf = await this.turfModel.findById(booking.turf);
    const isBooker = booking.bookedBy.toString() === userId;
    const isTurfOwner = turf?.postedBy.toString() === userId;

    if (!isBooker && !isTurfOwner) {
      throw new ForbiddenException('You can only update your own bookings');
    }

    // Handle timeSlots updates if provided
    if (updateBookingDto.timeSlots) {
      if (booking.status !== TurfBookingStatus.PENDING) {
        throw new BadRequestException(
          'Cannot modify time slots of non-pending bookings',
        );
      }

      const processedTimeSlots = updateBookingDto.timeSlots.map((slot) => ({
        startTime: new Date(slot.startTime),
        endTime: new Date(slot.endTime),
      }));

      // Sort time slots by start time
      processedTimeSlots.sort(
        (a, b) => a.startTime.getTime() - b.startTime.getTime(),
      );

      // Validate each time slot and check for overlaps
      for (let i = 0; i < processedTimeSlots.length; i++) {
        const currentSlot = processedTimeSlots[i];

        // Validate individual slot
        await this.validateBookingTime(
          currentSlot.startTime,
          currentSlot.endTime,
          booking.turf.toString(),
          turf!,
        );

        // Check for overlaps with other slots in the same booking
        if (i > 0) {
          const previousSlot = processedTimeSlots[i - 1];
          if (currentSlot.startTime < previousSlot.endTime) {
            throw new BadRequestException(
              `Time slots cannot overlap. Slot starting at ${currentSlot.startTime.toISOString()} overlaps with previous slot ending at ${previousSlot.endTime.toISOString()}`,
            );
          }
        }

        // Check for conflicts with existing bookings (excluding this booking)
        await this.checkSingleTimeSlotAvailability({
          turf: booking.turf.toString(),
          startTime: currentSlot.startTime.toISOString(),
          endTime: currentSlot.endTime.toISOString(),
          excludeBookingId: bookingId,
        });
      }

      // Recalculate total amount
      const newTotalAmount = await this.calculateMultiSlotBookingAmount(
        turf!,
        processedTimeSlots,
      );

      updateBookingDto = {
        ...updateBookingDto,
        timeSlots: processedTimeSlots as unknown as {
          startTime: string;
          endTime: string;
        }[],
        totalAmount: newTotalAmount,
      };
    }

    // Handle status updates
    if (updateBookingDto.status) {
      await this.validateStatusTransition(booking, updateBookingDto.status);
    }

    // Handle cancellation
    if (updateBookingDto.status === TurfBookingStatus.CANCELLED) {
      updateBookingDto.cancelledAt = new Date();
    }

    // Handle confirmation
    if (updateBookingDto.status === TurfBookingStatus.CONFIRMED) {
      updateBookingDto.confirmedAt = new Date();
    }

    Object.assign(booking, updateBookingDto);
    return await (
      await booking.save()
    ).populate(TurfBookingService.populateOptions);
  }

  async checkTimeSlotAvailability(
    checkAvailabilityDto: CheckTurfAvailabilityDto,
  ): Promise<boolean> {
    const { turf, timeSlots, excludeBookingId } = checkAvailabilityDto;

    // Convert time slots to Date objects
    const processedTimeSlots = timeSlots.map((slot) => ({
      startTime: new Date(slot.startTime),
      endTime: new Date(slot.endTime),
    }));

    // Check availability for each time slot
    for (const slot of processedTimeSlots) {
      await this.checkSingleTimeSlotAvailability({
        turf,
        startTime: slot.startTime.toISOString(),
        endTime: slot.endTime.toISOString(),
        excludeBookingId,
      });
    }

    return true;
  }

  private async checkSingleTimeSlotAvailability(checkDto: {
    turf: string;
    startTime: string;
    endTime: string;
    excludeBookingId?: string | null;
  }): Promise<boolean> {
    const {
      turf,
      startTime: startTimeStr,
      endTime: endTimeStr,
      excludeBookingId,
    } = checkDto;

    // Convert string dates to Date objects
    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);

    // Build query for overlap detection with timeSlots array
    const overlapQuery: QueryFilter<TurfBookingDocument> = {
      turf,
      status: { $in: [TurfBookingStatus.PENDING, TurfBookingStatus.CONFIRMED] },
      timeSlots: {
        $elemMatch: {
          $or: [
            {
              startTime: { $lte: startTime },
              endTime: { $gt: startTime },
            },
            {
              startTime: { $lt: endTime },
              endTime: { $gte: endTime },
            },
            {
              startTime: { $gte: startTime },
              endTime: { $lte: endTime },
            },
            {
              startTime: { $lte: startTime },
              endTime: { $gte: endTime },
            },
          ],
        },
      },
    };

    // Exclude specific booking if provided (for updates)
    if (excludeBookingId) {
      overlapQuery._id = { $ne: excludeBookingId };
    }

    const conflictingBooking =
      await this.turfBookingModel.findOne(overlapQuery);

    if (conflictingBooking) {
      // Find which specific time slot is conflicting
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

  private async calculateMultiSlotBookingAmount(
    turf: TurfDocument,
    timeSlots: { startTime: Date; endTime: Date }[],
  ): Promise<number> {
    let totalAmount = 0;

    for (const slot of timeSlots) {
      const slotAmount = await this.calculateBookingAmount(
        turf,
        slot.startTime,
        slot.endTime,
      );
      totalAmount += slotAmount;
    }

    return Math.round(totalAmount * 100) / 100; // Round to 2 decimal places
  }

  async findAll(
    filterDto: TurfBookingFilterDto,
  ): Promise<PaginatedResult<TurfBookingDocument>> {
    const {
      turf,
      bookedBy,
      status,
      paymentStatus,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filterDto;

    const filter: QueryFilter<TurfBookingDocument> = {};

    if (turf) filter.turf = turf;
    if (bookedBy) filter.bookedBy = bookedBy;
    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    // Date range filtering - check if any time slot overlaps with the date range
    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate && endDate) {
        // Booking has at least one slot that overlaps with the date range
        dateFilter['timeSlots'] = {
          $elemMatch: {
            startTime: { $lte: new Date(endDate) },
            endTime: { $gte: new Date(startDate) },
          },
        };
      } else if (startDate) {
        // Booking has at least one slot that starts on or after the start date
        dateFilter['timeSlots'] = {
          $elemMatch: {
            endTime: { $gte: new Date(startDate) },
          },
        };
      } else if (endDate) {
        // Booking has at least one slot that ends on or before the end date
        dateFilter['timeSlots'] = {
          $elemMatch: {
            startTime: { $lte: new Date(endDate) },
          },
        };
      }
      Object.assign(filter, dateFilter);
    }

    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      this.turfBookingModel
        .find(filter)
        .populate(TurfBookingService.populateOptions)
        .sort({ [sortBy]: sortDirection })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.turfBookingModel.countDocuments(filter),
    ]);
    
    return {
      data: bookings,
      totalDocuments: total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string): Promise<TurfBookingDocument | null> {
    return await this.turfBookingModel
      .findById(id)
      .populate(TurfBookingService.populateOptions)
      .exec();
  }

  async findUserBookings(
    userId: string,
    filterDto: TurfBookingFilterDto,
  ): Promise<PaginatedResult<TurfBookingDocument>> {
    return this.findAll({ ...filterDto, bookedBy: userId });
  }

  async findTurfBookings(
    turfId: string,
    filterDto: TurfBookingFilterDto,
  ): Promise<PaginatedResult<TurfBookingDocument>> {
    return this.findAll({ ...filterDto, turf: turfId });
  }

  async findTurfOwnerBookings(
    ownerId: string,
    filterDto: TurfBookingFilterDto,
  ): Promise<PaginatedResult<TurfBookingDocument>> {
    // Find all turfs owned by the user
    const ownedTurfs = await this.turfModel
      .find({ postedBy: ownerId })
      .select('_id');
    const turfIds = ownedTurfs.map((turf) => turf._id.toString());

    if (turfIds.length === 0) {
      return { data: [], totalDocuments: 0, page: 1, limit: 10, totalPages: 0 };
    }

    const filter: QueryFilter<TurfBookingDocument> = {
      turf: { $in: turfIds },
    };

    Object.assign(filter, filterDto);
    return this.findAll({ ...filterDto });
    // // Apply additional filters
    // if (filterDto.status) filter.status = filterDto.status;
    // if (filterDto.paymentStatus) filter.paymentStatus = filterDto.paymentStatus;
    // if (filterDto.startDate || filterDto.endDate) {
    //   const dateFilter: any = {};
    //   if (filterDto.startDate && filterDto.endDate) {
    //     // Booking has at least one slot that overlaps with the date range
    //     dateFilter['timeSlots'] = {
    //       $elemMatch: {
    //         startTime: { $lte: new Date(filterDto.endDate) },
    //         endTime: { $gte: new Date(filterDto.startDate) },
    //       },
    //     };
    //   } else if (filterDto.startDate) {
    //     // Booking has at least one slot that starts on or after the start date
    //     dateFilter['timeSlots'] = {
    //       $elemMatch: {
    //         endTime: { $gte: new Date(filterDto.startDate) },
    //       },
    //     };
    //   } else if (filterDto.endDate) {
    //     // Booking has at least one slot that ends on or before the end date
    //     dateFilter['timeSlots'] = {
    //       $elemMatch: {
    //         startTime: { $lte: new Date(filterDto.endDate) },
    //       },
    //     };
    //   }
    //   Object.assign(filter, dateFilter);
    // }

    // const page = filterDto.page || 1;
    // const limit = filterDto.limit || 10;
    // const sortBy = filterDto.sortBy || 'createdAt';
    // const sortOrder = filterDto.sortOrder || 'desc';

    // const sortDirection = sortOrder === 'asc' ? 1 : -1;
    // const skip = (page - 1) * limit;

    // const [bookings, total] = await Promise.all([
    //   this.turfBookingModel
    //     .find(filter)
    //     .populate(TurfBookingService.populateOptions)
    //     .sort({ [sortBy]: sortDirection })
    //     .skip(skip)
    //     .limit(limit)
    //     .exec(),
    //   this.turfBookingModel.countDocuments(filter),
    // ]);
    // return {
    //   data: bookings,
    //   totalDocuments: total,
    //   page,
    //   limit,
    //   totalPages: Math.ceil(total / limit),
    // };
  }

  async deleteBooking(id: string, userId: string): Promise<void> {
    const booking = await this.turfBookingModel.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Only allow deletion by the booker or turf owner
    const turf = await this.turfModel.findById(booking.turf);
    const isBooker = booking.bookedBy.toString() === userId;
    const isTurfOwner = turf?.postedBy.toString() === userId;

    if (!isBooker && !isTurfOwner) {
      throw new ForbiddenException('You can only delete your own bookings');
    }

    // Only allow deletion of pending or cancelled bookings
    if (![TurfBookingStatus.CANCELLED].includes(booking.status)) {
      throw new BadRequestException(
        'Cannot delete confirmed or completed bookings',
      );
    }

    await this.turfBookingModel.findByIdAndDelete(id);
  }

  private async validateBookingTime(
    startTime: Date,
    endTime: Date,
    turfId: string,
    turf: TurfDocument,
  ): Promise<void> {
    // Check if times are valid
    if (startTime >= endTime) {
      throw new BadRequestException('End time must be after start time');
    }

    // Check minimum booking duration (e.g., 1 hour)
    const durationMs = endTime.getTime() - startTime.getTime();
    const minDurationMs = 60 * 60 * 1000; // 1 hour
    if (durationMs < minDurationMs) {
      throw new BadRequestException('Minimum booking duration is 1 hour');
    }

    // Check maximum booking duration (e.g., 8 hours)
    const maxDurationMs = 8 * 60 * 60 * 1000; // 8 hours
    if (durationMs > maxDurationMs) {
      throw new BadRequestException('Maximum booking duration is 8 hours');
    }

    // Check if booking is within operating hours
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

      // Handle overnight operating hours
      if (closeTime <= openTime) {
        closeTime.setDate(closeTime.getDate() + 1);
      }

      if (bookingStart < openTime || bookingEnd > closeTime) {
        throw new BadRequestException(
          `Booking must be within operating hours: ${operatingHours.open} - ${operatingHours.close}`,
        );
      }
    }

    // Apply slot buffer time
    const bufferMs = turf.slotBufferMins * 60 * 1000;

    // Check for bookings ending just before or starting just after
    const bufferQuery = {
      turf: turfId,
      status: { $in: [TurfBookingStatus.PENDING, TurfBookingStatus.CONFIRMED] },
      $or: [
        // Booking ending within buffer time of start
        {
          endTime: {
            $gt: new Date(startTime.getTime() - bufferMs),
            $lte: startTime,
          },
        },
        // Booking starting within buffer time of end
        {
          startTime: {
            $gte: endTime,
            $lt: new Date(endTime.getTime() + bufferMs),
          },
        },
      ],
    };

    const conflictingBooking = await this.turfBookingModel.findOne(bufferQuery);
    if (conflictingBooking) {
      throw new ConflictException(
        `Booking conflicts with buffer time requirements. Minimum ${turf.slotBufferMins} minutes gap required between bookings.`,
      );
    }
  }

  private async calculateBookingAmount(
    turf: TurfDocument,
    startTime: Date,
    endTime: Date,
  ): Promise<number> {
    const durationHours =
      (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

    let baseAmount = turf.pricing.basePricePerHour * durationHours;

    // Apply weekend surge if applicable
    const dayOfWeek = startTime.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday

    if (isWeekend && turf.pricing.weekendSurge > 0) {
      const surgeAmount = baseAmount * (turf.pricing.weekendSurge / 100);
      baseAmount += surgeAmount;
    }

    return Math.round(baseAmount * 100) / 100; // Round to 2 decimal places
  }

  private async validateStatusTransition(
    booking: TurfBookingDocument,
    newStatus: TurfBookingStatus,
  ): Promise<void> {
    const currentStatus = booking.status;
    const validTransitions: Record<TurfBookingStatus, TurfBookingStatus[]> = {
      [TurfBookingStatus.PENDING]: [
        TurfBookingStatus.CONFIRMED,
        TurfBookingStatus.CANCELLED,
      ],
      [TurfBookingStatus.CONFIRMED]: [
        TurfBookingStatus.COMPLETED,
        TurfBookingStatus.CANCELLED,
      ],
      [TurfBookingStatus.CANCELLED]: [], // Cannot change from cancelled
      [TurfBookingStatus.COMPLETED]: [], // Cannot change from completed
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new BadRequestException(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
      );
    }
  }
}
