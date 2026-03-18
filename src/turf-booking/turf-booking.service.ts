import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import {
  TurfBooking,
  TurfBookingDocument,
} from './schemas/turf-booking.schema';
import { Turf, TurfDocument } from '../turf/schemas/turf.schema';
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
import { PaginatedResult } from '../common/interfaces/common';

@Injectable()
export class TurfBookingService {
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
    const {
      turf,
      startTime: startTimeStr,
      endTime: endTimeStr,
      playerCount,
      notes,
    } = createBookingDto;

    // Convert string dates to Date objects
    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);

    // Check if turf exists and is available
    const turfDoc = await this.turfModel.findById(turf);
    if (!turfDoc) {
      throw new NotFoundException('Turf not found');
    }

    if (!turfDoc.isAvailable) {
      throw new BadRequestException('Turf is not available for booking');
    }

    // Validate booking time constraints
    await this.validateBookingTime(startTime, endTime, turf, turfDoc);

    // Check for time slot conflicts with strict overlap validation
    await this.checkTimeSlotAvailability({
      turf,
      startTime: startTimeStr,
      endTime: endTimeStr,
    });

    // Calculate total amount based on turf pricing
    const totalAmount = await this.calculateBookingAmount(
      turfDoc,
      startTime,
      endTime,
    );

    // Create the booking
    const booking = new this.turfBookingModel({
      turf,
      bookedBy: userId,
      startTime,
      endTime,
      playerCount,
      notes,
      totalAmount,
      status: TurfBookingStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
    });

    return await booking.save();
  }

  async updateBooking(
    bookingId: string,
    updateBookingDto: UpdateTurfBookingDto & {
      cancelledAt?: Date;
      confirmedAt?: Date;
    },
    userId: string,
  ): Promise<TurfBookingDocument> {
    const booking = await this.turfBookingModel.findById(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Check if user is the booker or turf owner
    const turf = await this.turfModel.findById(booking.turf);
    const isBooker = booking.bookedBy === userId;
    const isTurfOwner = turf?.postedBy === userId;

    if (!isBooker && !isTurfOwner) {
      throw new ForbiddenException('You can only update your own bookings');
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
    return await booking.save();
  }

  async checkTimeSlotAvailability(
    checkAvailabilityDto: CheckTurfAvailabilityDto,
  ): Promise<boolean> {
    const {
      turf,
      startTime: startTimeStr,
      endTime: endTimeStr,
      excludeBookingId,
    } = checkAvailabilityDto;

    // Convert string dates to Date objects
    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);

    // Build query for overlap detection
    const overlapQuery: QueryFilter<TurfBookingDocument> = {
      turf,
      status: { $in: [TurfBookingStatus.PENDING, TurfBookingStatus.CONFIRMED] },
      $or: [
        // New booking starts during existing booking
        {
          startTime: { $lte: startTime },
          endTime: { $gt: startTime },
        },
        // New booking ends during existing booking
        {
          startTime: { $lt: endTime },
          endTime: { $gte: endTime },
        },
        // New booking completely contains existing booking
        {
          startTime: { $gte: startTime },
          endTime: { $lte: endTime },
        },
        // Existing booking completely contains new booking
        {
          startTime: { $lte: startTime },
          endTime: { $gte: endTime },
        },
      ],
    };

    // Exclude specific booking if provided (for updates)
    if (excludeBookingId) {
      overlapQuery._id = { $ne: excludeBookingId };
    }

    const conflictingBooking =
      await this.turfBookingModel.findOne(overlapQuery);

    if (conflictingBooking) {
      throw new ConflictException(
        `Time slot conflicts with existing booking from ${conflictingBooking.startTime.toISOString()} to ${conflictingBooking.endTime.toISOString()}`,
      );
    }

    return true;
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

    // Date range filtering
    if (startDate || endDate) {
      filter.startTime = {};
      if (startDate) filter.startTime.$gte = new Date(startDate);
      if (endDate) filter.startTime.$lte = new Date(endDate);
    }

    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      this.turfBookingModel
        .find(filter)
        .populate('turf', 'name location images pricing')
        .populate('bookedBy', 'name email')
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
      .populate('turf', 'name location images pricing postedBy')
      .populate('bookedBy', 'name email')
      .exec();
  }

  async findUserBookings(
    userId: string,
    filterDto: Partial<TurfBookingFilterDto>,
  ): Promise<PaginatedResult<TurfBookingDocument>> {
    return this.findAll({ ...filterDto, bookedBy: userId });
  }

  async findTurfBookings(
    turfId: string,
    filterDto: Partial<TurfBookingFilterDto>,
  ): Promise<PaginatedResult<TurfBookingDocument>> {
    return this.findAll({ ...filterDto, turf: turfId });
  }

  async findTurfOwnerBookings(
    ownerId: string,
    filterDto: Partial<TurfBookingFilterDto>,
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

    // Apply additional filters
    if (filterDto.status) filter.status = filterDto.status;
    if (filterDto.paymentStatus) filter.paymentStatus = filterDto.paymentStatus;
    if (filterDto.startDate || filterDto.endDate) {
      filter.startTime = {};
      if (filterDto.startDate)
        filter.startTime.$gte = new Date(filterDto.startDate);
      if (filterDto.endDate)
        filter.startTime.$lte = new Date(filterDto.endDate);
    }

    const page = filterDto.page || 1;
    const limit = filterDto.limit || 10;
    const sortBy = filterDto.sortBy || 'createdAt';
    const sortOrder = filterDto.sortOrder || 'desc';

    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      this.turfBookingModel
        .find(filter)
        .populate('turf', 'name location images pricing')
        .populate('bookedBy', 'name email')
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

  async deleteBooking(id: string, userId: string): Promise<void> {
    const booking = await this.turfBookingModel.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Only allow deletion by the booker or turf owner
    const turf = await this.turfModel.findById(booking.turf);
    const isBooker = booking.bookedBy === userId;
    const isTurfOwner = turf?.postedBy === userId;

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
