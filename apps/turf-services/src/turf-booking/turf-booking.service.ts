import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import moment from 'moment';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PopulateOptions, QueryFilter, Types } from 'mongoose';
import {
  TurfBooking,
  TurfBookingDocument,
} from './schemas/turf-booking.schema';
import {
  turfSelectFields,
  Turf,
  TurfDocument,
} from '../turf/schemas/turf.schema';
import { TurfStatus } from '../turf/schemas/turf.schema';
import TurfBookingStatsUtility from './utility/turf-booking.stats.utility';
import {
  CreateTurfBookingDto,
  UpdateTurfBookingDto,
  TurfBookingFilterDto,
  CheckTurfAvailabilityDto,
  VerifyRazorpayPaymentDto,
} from './dto/turf-booking.dto';
import {
  TurfBookingStatus,
  PaymentStatus,
  ITurfTimeSlotListing,
  SlotHoldStatus,
} from './interfaces/turf-booking.interface';
import { PaginatedResult } from '../core/interfaces/common';
import { buildMongoSortOptions } from '../core/utils/mongo-sort.util';
import { IRajorpayOrder } from '../core/interfaces/rajorpay.interface';
import { userSelectFields } from '../users/schemas/user.schema';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { TurfBookingUtility } from './utility/turf-booking.utility';
import {
  notifyBookingCancelledParty,
  notifyBookerPaymentFailed,
  notifyTurfBookingConfirmedParties,
} from './utility/turf-booking-notification.utility';
import { NotificationService } from '../notification/notification.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletType } from '../wallet/interfaces/wallet.interface';
import { resolveId } from '../core/utils/mongo-ref.util';

function emptyPaginatedResult(
  page: number,
  limit: number,
): PaginatedResult<TurfBookingDocument> {
  return {
    data: [],
    totalDocuments: 0,
    page,
    limit,
    totalPages: 0,
  };
}

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
    private readonly rajorpayService: RajorpayService,
    private readonly notificationService: NotificationService,
    private readonly walletService: WalletService,
  ) {}

  async createBooking(
    createBookingDto: CreateTurfBookingDto,
    userId: string,
  ): Promise<TurfBookingDocument> {
    await this.releaseExpiredSlotHolds();
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

    if (turfDoc.status !== TurfStatus.PUBLISHED) {
      throw new BadRequestException(
        'Turf is not published and cannot be booked',
      );
    }

    // Sort time slots by start time to ensure they don't overlap
    processedTimeSlots.sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );

    // Validate each time slot and check for overlaps between them
    for (let i = 0; i < processedTimeSlots.length; i++) {
      const currentSlot = processedTimeSlots[i];

      // Validate individual slot
      await TurfBookingUtility.validateBookingTime(
        this.turfBookingModel,
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
      await TurfBookingUtility.checkSingleTimeSlotAvailability(
        this.turfBookingModel,
        {
          turf,
          startTime: currentSlot.startTime.toISOString(),
          endTime: currentSlot.endTime.toISOString(),
        },
      );
    }

    // Calculate total amount for all time slots
    const totalAmount =
      await TurfBookingUtility.calculateMultiSlotBookingAmount(
        turfDoc,
        processedTimeSlots,
      );
    const { ownerPayoutAmount, platformFeeAmount } =
      this.rajorpayService.calculateOwnerPayoutAmount(totalAmount);

    // Create the booking
    const booking = new this.turfBookingModel({
      turf,
      bookedBy: userId,
      timeSlots: processedTimeSlots,
      playerCount,
      notes,
      totalAmount,
      ownerPayoutAmount,
      platformFeeAmount,
      status: TurfBookingStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      paymentExpiresAt: TurfBookingUtility.getPaymentExpiryDate(),
      slotHoldStatus: SlotHoldStatus.ACTIVE,
    });

    const savedBooking = await booking.save();
    return await savedBooking.populate(TurfBookingService.populateOptions);
  }

  async createBookingOrder(
    createBookingDto: CreateTurfBookingDto,
    userId: string,
  ): Promise<{
    booking: TurfBookingDocument;
    order: IRajorpayOrder;
  }> {
    const booking = await this.createBooking(createBookingDto, userId);
    const order = await this.rajorpayService.createOrder(
      booking.totalAmount,
      `booking_${booking._id.toString()}`,
    );

    booking.razorpayOrderId = order.id;
    await booking.save();

    return { booking, order };
  }

  async verifyRazorpayPayment(
    verifyPaymentDto: VerifyRazorpayPaymentDto,
    userId: string,
  ): Promise<TurfBookingDocument> {
    await this.releaseExpiredSlotHolds();
    const {
      bookingId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = verifyPaymentDto;
    const booking = await this.turfBookingModel.findById(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (resolveId(booking.bookedBy) !== resolveId(userId)) {
      throw new ForbiddenException(
        'You can only verify your own booking payment',
      );
    }

    if (booking.paymentStatus === PaymentStatus.PAID) {
      return (await booking.populate(
        TurfBookingService.populateOptions,
      )) as TurfBookingDocument;
    }

    if (booking.status !== TurfBookingStatus.PENDING) {
      throw new BadRequestException('Only pending bookings can be paid');
    }

    if (
      booking.paymentExpiresAt &&
      new Date(booking.paymentExpiresAt) <= new Date()
    ) {
      throw new BadRequestException(
        'Booking hold expired. Please create a new booking order.',
      );
    }

    if (
      booking.razorpayOrderId &&
      booking.razorpayOrderId !== razorpay_order_id
    ) {
      throw new BadRequestException(
        'Payment order does not match this booking',
      );
    }

    const isValidSignature = this.rajorpayService.verifyPaymentSignature({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });
    if (!isValidSignature) {
      throw new BadRequestException('Invalid payment signature');
    }

    for (const slot of booking.timeSlots) {
      await TurfBookingUtility.checkSingleTimeSlotAvailability(
        this.turfBookingModel,
        {
          turf: booking.turf.toString(),
          startTime: new Date(slot.startTime).toISOString(),
          endTime: new Date(slot.endTime).toISOString(),
          excludeBookingId: bookingId,
        },
      );
    }

    booking.razorpayOrderId = razorpay_order_id;
    booking.razorpayPaymentId = razorpay_payment_id;
    booking.paymentStatus = PaymentStatus.PAID;
    booking.status = TurfBookingStatus.CONFIRMED;
    booking.slotHoldStatus = SlotHoldStatus.RELEASED;
    booking.paymentExpiresAt = undefined;
    booking.confirmedAt = new Date();
    booking.paidAt = new Date();
    booking.bookingId = TurfBookingUtility.generateBookingId(
      booking._id.toString(),
    );

    await booking.save();
    if (booking.ownerPayoutAmount && booking.ownerPayoutAmount > 0) {
      const turfDoc = await this.turfModel
        .findById(booking.turf)
        .select('postedBy');
      if (turfDoc) {
        await this.walletService.moveAmountToEscrow(
          WalletType.TURF,
          booking._id.toString(),
          turfDoc.postedBy.toString(),
          booking.ownerPayoutAmount,
        );
      }
    }

    await notifyTurfBookingConfirmedParties(
      this.notificationService,
      this.turfModel,
      booking,
    );

    return (await booking.populate(
      TurfBookingService.populateOptions,
    )) as TurfBookingDocument;
  }

  async updateBooking(
    bookingId: string,
    updateBookingDto: UpdateTurfBookingDto & {
      cancelledAt?: Date;
      confirmedAt?: Date;
      totalAmount?: number;
      ownerPayoutAmount?: number;
      platformFeeAmount?: number;
    },
    userId: string,
  ): Promise<TurfBookingDocument> {
    const booking = await this.turfBookingModel.findById(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Check if user is the booker or turf owner
    const turf = await this.turfModel.findById(booking.turf);
    const isBooker = resolveId(booking.bookedBy) === resolveId(userId);
    const isTurfOwner = turf && resolveId(turf.postedBy) === resolveId(userId);

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
        await TurfBookingUtility.validateBookingTime(
          this.turfBookingModel,
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
        await TurfBookingUtility.checkSingleTimeSlotAvailability(
          this.turfBookingModel,
          {
            turf: booking.turf.toString(),
            startTime: currentSlot.startTime.toISOString(),
            endTime: currentSlot.endTime.toISOString(),
            excludeBookingId: bookingId,
          },
        );
      }

      // Recalculate total amount
      const newTotalAmount =
        await TurfBookingUtility.calculateMultiSlotBookingAmount(
          turf!,
          processedTimeSlots,
        );
      const { ownerPayoutAmount: newOwnerPayoutAmount } =
        this.rajorpayService.calculateOwnerPayoutAmount(newTotalAmount);
      updateBookingDto = {
        ...updateBookingDto,
        timeSlots: processedTimeSlots as unknown as {
          startTime: string;
          endTime: string;
        }[],
        totalAmount: newTotalAmount,
        ownerPayoutAmount: newOwnerPayoutAmount,
        platformFeeAmount: Math.max(0, newTotalAmount - newOwnerPayoutAmount),
      };
    }

    // Handle status updates
    if (updateBookingDto.status) {
      TurfBookingUtility.validateStatusTransition(
        booking.status,
        updateBookingDto.status,
      );
    }

    // Handle cancellation
    if (updateBookingDto.status === TurfBookingStatus.CANCELLED) {
      updateBookingDto.cancelledAt = new Date();
    }

    // Handle confirmation
    if (updateBookingDto.status === TurfBookingStatus.CONFIRMED) {
      updateBookingDto.confirmedAt = new Date();
    }

    const becomingCancelled =
      updateBookingDto.status === TurfBookingStatus.CANCELLED &&
      booking.status !== TurfBookingStatus.CANCELLED;
    const becomingCompleted =
      updateBookingDto.status === TurfBookingStatus.COMPLETED &&
      booking.status !== TurfBookingStatus.COMPLETED;

    Object.assign(booking, updateBookingDto);
    await booking.save();

    const ownerPayoutAmount =
      booking.ownerPayoutAmount ??
      this.rajorpayService.calculateOwnerPayoutAmount(booking.totalAmount)
        .ownerPayoutAmount;

    if (becomingCompleted && turf && ownerPayoutAmount > 0) {
      await this.walletService.releaseEscrowToTotal(
        WalletType.TURF,
        booking._id.toString(),
        turf.postedBy.toString(),
        ownerPayoutAmount,
      );
    }

    if (
      becomingCancelled &&
      turf &&
      booking.paymentStatus === PaymentStatus.PAID &&
      ownerPayoutAmount > 0
    ) {
      await this.walletService.deductEscrow(
        WalletType.TURF,
        turf.postedBy.toString(),
        ownerPayoutAmount,
      );
    }

    if (becomingCancelled && turf) {
      if (isTurfOwner && !isBooker) {
        await notifyBookingCancelledParty(this.notificationService, {
          recipientUserId: booking.bookedBy.toString(),
          bookingId: booking._id.toString(),
          turfName: turf.name,
          cancelledBy: 'owner',
        });
      } else if (isBooker && !isTurfOwner) {
        await notifyBookingCancelledParty(this.notificationService, {
          recipientUserId: turf.postedBy.toString(),
          bookingId: booking._id.toString(),
          turfName: turf.name,
          cancelledBy: 'booker',
        });
      }
    }

    return (await booking.populate(
      TurfBookingService.populateOptions,
    )) as TurfBookingDocument;
  }

  /**
   * Builds 1-hour slots between the turf operating window for the given calendar day
   * and marks overlap with pending/confirmed bookings.
   */
  async getTimeSlotsForDate(
    turfId: string,
    dateStr: string,
  ): Promise<ITurfTimeSlotListing[]> {
    await this.releaseExpiredSlotHolds();
    const turfDoc = await this.turfModel.findById(turfId);
    if (!turfDoc) {
      throw new NotFoundException('Turf not found');
    }

    if (turfDoc.status !== TurfStatus.PUBLISHED) {
      throw new BadRequestException(
        'Turf is not published and slot availability cannot be checked',
      );
    }

    const dayRef = moment(dateStr).startOf('day').toDate();

    const { operatingHours } = turfDoc;
    const openTime = new Date(dayRef);
    const closeTime = new Date(dayRef);

    if (operatingHours?.open && operatingHours?.close) {
      const [openHour, openMin] = operatingHours.open.split(':').map(Number);
      const [closeHour, closeMin] = operatingHours.close.split(':').map(Number);
      openTime.setHours(openHour, openMin, 0, 0);
      closeTime.setHours(closeHour, closeMin, 0, 0);
      if (closeTime <= openTime) {
        closeTime.setDate(closeTime.getDate() + 1);
      }
    } else {
      openTime.setHours(6, 0, 0, 0);
      closeTime.setHours(23, 0, 0, 0);
    }

    const HOUR_MS = 60 * 60 * 1000;
    const slotBufferMins = Math.max(0, Number(turfDoc.slotBufferMins) || 0);
    const slotBufferMs = slotBufferMins * 60 * 1000;
    const slotStepMs = HOUR_MS + slotBufferMs;
    const slotStarts: Date[] = [];
    for (
      let t = openTime.getTime();
      t + HOUR_MS <= closeTime.getTime();
      t += slotStepMs
    ) {
      slotStarts.push(new Date(t));
    }

    const bookings = await this.turfBookingModel
      .find({
        turf: turfId,
        ...TurfBookingUtility.buildActiveBookingFilter(),
        timeSlots: {
          $elemMatch: {
            startTime: { $lt: closeTime },
            endTime: { $gt: openTime },
          },
        },
      })
      .select('timeSlots')
      .lean()
      .exec();

    const now = new Date();
    const result: ITurfTimeSlotListing[] = [];

    for (const slotStart of slotStarts) {
      const slotEnd = new Date(slotStart.getTime() + HOUR_MS);
      const slotBufferedEnd = new Date(slotEnd.getTime() + slotBufferMs);
      let isBooked = false;
      for (const b of bookings) {
        for (const ts of b.timeSlots) {
          const bStart = new Date(ts.startTime);
          const bBufferedEnd = new Date(
            new Date(ts.endTime).getTime() + slotBufferMs,
          );
          if (slotStart < bBufferedEnd && slotBufferedEnd > bStart) {
            isBooked = true;
            break;
          }
        }
        if (isBooked) break;
      }

      const price = TurfBookingUtility.calculateBookingAmount(
        turfDoc,
        slotStart,
        slotEnd,
      );

      const isPast = slotEnd <= now;
      const isAvailable = turfDoc.isAvailable && !isBooked && !isPast;

      result.push({
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        isAvailable,
        price,
        isBooked,
      });
    }

    return result;
  }

  async checkTimeSlotAvailability(
    checkAvailabilityDto: CheckTurfAvailabilityDto,
  ): Promise<boolean> {
    await this.releaseExpiredSlotHolds();
    const { turf, timeSlots, excludeBookingId } = checkAvailabilityDto;

    // Convert time slots to Date objects
    const processedTimeSlots = timeSlots.map((slot) => ({
      startTime: new Date(slot.startTime),
      endTime: new Date(slot.endTime),
    }));

    // Check availability for each time slot
    for (const slot of processedTimeSlots) {
      await TurfBookingUtility.checkSingleTimeSlotAvailability(
        this.turfBookingModel,
        {
          turf,
          startTime: slot.startTime.toISOString(),
          endTime: slot.endTime.toISOString(),
          excludeBookingId,
        },
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
      upcoming,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filterDto;

    const filter: QueryFilter<TurfBookingDocument> = {};
    const now = new Date();

    if (turf) filter.turf = turf;
    if (bookedBy) filter.bookedBy = bookedBy;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    if (upcoming === true) {
      filter.timeSlots = {
        $elemMatch: { endTime: { $gte: now } },
      };
      if (status?.length) {
        filter.status = status.length === 1 ? status[0] : { $in: status };
      }
    } else if (upcoming === false) {
      filter.$or = [
        {
          status: {
            $in: [TurfBookingStatus.COMPLETED, TurfBookingStatus.CANCELLED],
          },
        },
        {
          status: {
            $in: [TurfBookingStatus.CONFIRMED, TurfBookingStatus.PENDING],
          },
          timeSlots: {
            $not: { $elemMatch: { endTime: { $gte: now } } },
          },
        },
      ];
    } else if (status?.length) {
      filter.status = status.length === 1 ? status[0] : { $in: status };
    }

    // Date range filtering - check if any time slot overlaps with the date range
    if ((startDate || endDate) && upcoming === undefined) {
      const dateFilter: any = {};
      if (startDate && endDate) {
        // Booking has at least one slot that overlaps with the date range
        dateFilter['timeSlots'] = {
          $elemMatch: {
            startTime: { $lte: endDate },
            endTime: { $gte: startDate },
          },
        };
      } else if (startDate) {
        // Booking has at least one slot that starts on or after the start date
        dateFilter['timeSlots'] = {
          $elemMatch: {
            endTime: { $gte: startDate },
          },
        };
      } else if (endDate) {
        // Booking has at least one slot that ends on or before the end date
        dateFilter['timeSlots'] = {
          $elemMatch: {
            startTime: { $lte: endDate },
          },
        };
      }
      Object.assign(filter, dateFilter);
    }

    const sortSpec = buildMongoSortOptions(
      sortBy && sortOrder ? `${sortBy}:${sortOrder}` : undefined,
      {
        defaultSort: { createdAt: -1 },
        allowedFields: new Set(['createdAt', 'updatedAt']),
        whenParsedEmpty: 'default',
      },
    );

    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      this.turfBookingModel
        .find(filter)
        .populate(TurfBookingService.populateOptions)
        .sort(sortSpec)
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
    const ownedTurfs = await this.turfModel
      .find({ postedBy: ownerId })
      .select('_id');
    const turfIds = ownedTurfs.map((turf) => turf._id.toString());

    const { page = 1, limit = 10, turf } = filterDto;
    if (turfIds.length === 0) {
      return emptyPaginatedResult(page, limit);
    }

    const turfIdSet = new Set(turfIds.map((id) => resolveId(id)));
    let scopedTurfFilter: string | { $in: string[] };

    if (turf) {
      if (!turfIdSet.has(resolveId(turf))) {
        return emptyPaginatedResult(page, limit);
      }
      scopedTurfFilter = turf;
    } else {
      scopedTurfFilter = { $in: turfIds };
    }

    return this.findAll({
      ...filterDto,
      turf: scopedTurfFilter as TurfBookingFilterDto['turf'],
    });
  }

  async getTurfOwnerBookingStats(ownerId: string, turfIds?: string[]) {
    const ownerTurfIds =
      await TurfBookingStatsUtility.resolveAndValidateTurfIds(
        this.turfModel,
        ownerId,
        turfIds,
      );

    const bookingStatusStats: Record<TurfBookingStatus, number> = {
      [TurfBookingStatus.PENDING]: 0,
      [TurfBookingStatus.CONFIRMED]: 0,
      [TurfBookingStatus.CANCELLED]: 0,
      [TurfBookingStatus.COMPLETED]: 0,
    };

    if (ownerTurfIds.length === 0) {
      return {
        totalBookings: { count: 0 },
        todaysBookings: {
          count: 0,
          trend: '+0%',
          trendInterval: 'daily' as const,
        },
        thisWeekBookings: {
          count: 0,
          trend: '+0%',
          trendInterval: 'weekly' as const,
        },
        totalRevenue: {
          count: 0,
          trend: '+0%',
          trendInterval: 'weekly' as const,
        },
        completionRate: {
          count: 0,
          trend: '+0%',
          trendInterval: 'weekly' as const,
        },
        bookingStatusStats,
      };
    }

    const todayStart = moment().startOf('day').toDate();
    const yesterdayStart = moment().subtract(1, 'day').startOf('day').toDate();
    const weekStart = moment().startOf('week').toDate();
    const previousWeekStart = moment()
      .subtract(1, 'week')
      .startOf('week')
      .toDate();

    const groupedStats = await this.turfBookingModel.aggregate<{
      _id: null;
      totalBookings: number;
      todaysBookings: number;
      yesterdayBookings: number;
      thisWeekBookings: number;
      previousWeekBookings: number;
      totalRevenue: number;
      thisWeekRevenue: number;
      previousWeekRevenue: number;
      thisWeekCompletedBookings: number;
      previousWeekCompletedBookings: number;
      pendingBookings: number;
      confirmedBookings: number;
      cancelledBookings: number;
      completedBookings: number;
    }>([
      {
        $match: {
          turf: { $in: ownerTurfIds },
        },
      },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          todaysBookings: {
            $sum: {
              $cond: [{ $gte: ['$createdAt', todayStart] }, 1, 0],
            },
          },
          yesterdayBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$createdAt', yesterdayStart] },
                    { $lt: ['$createdAt', todayStart] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          thisWeekBookings: {
            $sum: {
              $cond: [{ $gte: ['$createdAt', weekStart] }, 1, 0],
            },
          },
          previousWeekBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$createdAt', previousWeekStart] },
                    { $lt: ['$createdAt', weekStart] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalRevenue: {
            $sum: {
              $cond: [
                { $eq: ['$paymentStatus', PaymentStatus.PAID] },
                '$totalAmount',
                0,
              ],
            },
          },
          thisWeekRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$paymentStatus', PaymentStatus.PAID] },
                    { $gte: ['$createdAt', weekStart] },
                  ],
                },
                '$totalAmount',
                0,
              ],
            },
          },
          previousWeekRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$paymentStatus', PaymentStatus.PAID] },
                    { $gte: ['$createdAt', previousWeekStart] },
                    { $lt: ['$createdAt', weekStart] },
                  ],
                },
                '$totalAmount',
                0,
              ],
            },
          },
          thisWeekCompletedBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', TurfBookingStatus.COMPLETED] },
                    { $gte: ['$createdAt', weekStart] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          previousWeekCompletedBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', TurfBookingStatus.COMPLETED] },
                    { $gte: ['$createdAt', previousWeekStart] },
                    { $lt: ['$createdAt', weekStart] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          pendingBookings: {
            $sum: {
              $cond: [{ $eq: ['$status', TurfBookingStatus.PENDING] }, 1, 0],
            },
          },
          confirmedBookings: {
            $sum: {
              $cond: [{ $eq: ['$status', TurfBookingStatus.CONFIRMED] }, 1, 0],
            },
          },
          cancelledBookings: {
            $sum: {
              $cond: [{ $eq: ['$status', TurfBookingStatus.CANCELLED] }, 1, 0],
            },
          },
          completedBookings: {
            $sum: {
              $cond: [{ $eq: ['$status', TurfBookingStatus.COMPLETED] }, 1, 0],
            },
          },
        },
      },
    ]);

    const summary = groupedStats[0];
    if (!summary) {
      return {
        totalBookings: { count: 0 },
        todaysBookings: {
          count: 0,
          trend: '+0%',
          trendInterval: 'daily' as const,
        },
        thisWeekBookings: {
          count: 0,
          trend: '+0%',
          trendInterval: 'weekly' as const,
        },
        totalRevenue: {
          count: 0,
          trend: '+0%',
          trendInterval: 'weekly' as const,
        },
        completionRate: {
          count: 0,
          trend: '+0%',
          trendInterval: 'weekly' as const,
        },
        bookingStatusStats,
      };
    }

    bookingStatusStats[TurfBookingStatus.PENDING] = summary.pendingBookings;
    bookingStatusStats[TurfBookingStatus.CONFIRMED] = summary.confirmedBookings;
    bookingStatusStats[TurfBookingStatus.CANCELLED] = summary.cancelledBookings;
    bookingStatusStats[TurfBookingStatus.COMPLETED] = summary.completedBookings;

    const completionRate =
      summary.totalBookings > 0
        ? Number(
            ((summary.completedBookings / summary.totalBookings) * 100).toFixed(
              2,
            ),
          )
        : 0;
    const thisWeekCompletionRate =
      summary.thisWeekBookings > 0
        ? (summary.thisWeekCompletedBookings / summary.thisWeekBookings) * 100
        : 0;
    const previousWeekCompletionRate =
      summary.previousWeekBookings > 0
        ? (summary.previousWeekCompletedBookings /
            summary.previousWeekBookings) *
          100
        : 0;

    return {
      totalBookings: {
        count: summary.totalBookings,
      },
      todaysBookings: {
        count: summary.todaysBookings,
        trend: TurfBookingStatsUtility.formatTrendPercentage(
          summary.todaysBookings,
          summary.yesterdayBookings,
        ),
        trendInterval: 'daily' as const,
      },
      thisWeekBookings: {
        count: summary.thisWeekBookings,
        trend: TurfBookingStatsUtility.formatTrendPercentage(
          summary.thisWeekBookings,
          summary.previousWeekBookings,
        ),
        trendInterval: 'weekly' as const,
      },
      totalRevenue: {
        count: summary.totalRevenue,
        trend: TurfBookingStatsUtility.formatTrendPercentage(
          summary.thisWeekRevenue,
          summary.previousWeekRevenue,
        ),
        trendInterval: 'weekly' as const,
      },
      completionRate: {
        count: completionRate,
        trend: TurfBookingStatsUtility.formatTrendPercentage(
          thisWeekCompletionRate,
          previousWeekCompletionRate,
        ),
        trendInterval: 'weekly' as const,
      },
      bookingStatusStats,
    };
  }

  async deleteBooking(id: string, userId: string): Promise<void> {
    const booking = await this.turfBookingModel.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Only allow deletion by the booker or turf owner
    const turf = await this.turfModel.findById(booking.turf);
    const isBooker = resolveId(booking.bookedBy) === resolveId(userId);
    const isTurfOwner = turf && resolveId(turf.postedBy) === resolveId(userId);

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

  async releaseExpiredSlotHolds(): Promise<void> {
    const now = new Date();
    const expired = await this.turfBookingModel.find({
      status: TurfBookingStatus.PENDING,
      slotHoldStatus: SlotHoldStatus.ACTIVE,
      paymentExpiresAt: { $lte: now },
    });

    if (!expired.length) {
      return;
    }

    await this.turfBookingModel.updateMany(
      {
        _id: { $in: expired.map((b) => b._id) },
      },
      {
        $set: {
          status: TurfBookingStatus.CANCELLED,
          paymentStatus: PaymentStatus.FAILED,
          slotHoldStatus: SlotHoldStatus.RELEASED,
          cancelledAt: now,
          cancelReason: 'Payment was not confirmed in time',
        },
      },
    );

    for (const booking of expired) {
      const turf = await this.turfModel
        .findById(booking.turf)
        .select('name')
        .lean();
      if (turf) {
        await notifyBookerPaymentFailed(
          this.notificationService,
          booking,
          turf.name,
          'hold_expired',
        );
      }
    }
  }
}
