import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PopulateOptions, Types } from 'mongoose';
import {
  EventBooking,
  EventBookingDocument,
} from './schemas/event-booking.schema';
import {
  CreateEventBookingDto,
  EventBookingFilterDto,
  UpdateEventBookingDto,
  VerifyEventRazorpayPaymentDto,
} from './dto/event-booking.dto';
import {
  EventBookingStatus,
  PaymentStatus,
} from './interfaces/event-booking.interface';
import { EventsService } from '../events/events.service';
import { Event, EventDocument, eventSelectFields } from '../events/schemas/event.schema';
import { PaginatedResult } from '../core/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletType } from '../wallet/interfaces/wallet.interface';
import { EventBookingUtility } from './utility/event-booking.utility';
import { IRajorpayOrder } from '../core/interfaces/rajorpay.interface';
import { UserRole } from '../auth/decorators/roles.decorator';

@Injectable()
export class EventBookingService {
  static populateOptions: PopulateOptions[] = [
    { path: 'event', select: eventSelectFields },
    { path: 'bookedBy', select: userSelectFields },
  ];

  constructor(
    @InjectModel(EventBooking.name)
    private readonly eventBookingModel: Model<EventBookingDocument>,
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
    private readonly eventsService: EventsService,
    private readonly rajorpayService: RajorpayService,
    private readonly walletService: WalletService,
  ) {}

  async createBookingOrder(
    eventId: string,
    dto: CreateEventBookingDto,
    userId: string,
  ): Promise<{ booking: EventBookingDocument; order?: IRajorpayOrder }> {
    await this.releaseExpiredPaymentHolds();
    const event = await this.eventsService.getPublishedEventForBooking(eventId);
    await this.assertCapacityAvailable(event, 1);

    const totalAmount = event.price;
    const { ownerPayoutAmount: organizerPayoutAmount, platformFeeAmount } =
      this.rajorpayService.calculateOwnerPayoutAmount(totalAmount);

    const booking = new this.eventBookingModel({
      event: eventId,
      bookedBy: userId,
      fullName: dto.fullName,
      contactNumber: dto.contactNumber,
      notes: dto.notes,
      playerCount: dto.playerCount,
      totalAmount,
      organizerPayoutAmount,
      platformFeeAmount,
      status: EventBookingStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      paymentExpiresAt: EventBookingUtility.getPaymentExpiryDate(),
    });

    const saved = await booking.save();

    if (totalAmount <= 0) {
      saved.paymentStatus = PaymentStatus.PAID;
      saved.status = EventBookingStatus.CONFIRMED;
      saved.confirmedAt = new Date();
      saved.paymentExpiresAt = undefined;
      await saved.save();
      await this.eventsService.incrementRegisteredCount(eventId, 1);
      return {
        booking: (await saved.populate(
          EventBookingService.populateOptions,
        )) as EventBookingDocument,
      };
    }

    const order = await this.rajorpayService.createOrder(
      totalAmount,
      `event_booking_${saved._id.toString()}`,
    );
    saved.razorpayOrderId = order.id;
    await saved.save();

    return {
      booking: (await saved.populate(
        EventBookingService.populateOptions,
      )) as EventBookingDocument,
      order,
    };
  }

  async verifyRazorpayPayment(
    eventId: string,
    dto: VerifyEventRazorpayPaymentDto,
    userId: string,
  ): Promise<EventBookingDocument> {
    await this.releaseExpiredPaymentHolds();
    const booking = await this.eventBookingModel.findById(dto.bookingId);
    if (!booking || booking.event.toString() !== eventId) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.bookedBy.toString() !== userId) {
      throw new ForbiddenException(
        'You can only verify your own booking payment',
      );
    }

    if (booking.paymentStatus === PaymentStatus.PAID) {
      return (await booking.populate(
        EventBookingService.populateOptions,
      )) as EventBookingDocument;
    }

    if (booking.status !== EventBookingStatus.PENDING) {
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
      booking.razorpayOrderId !== dto.razorpay_order_id
    ) {
      throw new BadRequestException(
        'Payment order does not match this booking',
      );
    }

    const isValid = this.rajorpayService.verifyPaymentSignature({
      razorpayOrderId: dto.razorpay_order_id,
      razorpayPaymentId: dto.razorpay_payment_id,
      razorpaySignature: dto.razorpay_signature,
    });
    if (!isValid) {
      throw new BadRequestException('Invalid payment signature');
    }

    const event = await this.eventsService.getPublishedEventForBooking(eventId);
    await this.assertCapacityAvailable(event, 1, booking._id.toString());

    booking.razorpayOrderId = dto.razorpay_order_id;
    booking.paymentId = dto.razorpay_payment_id;
    booking.paymentStatus = PaymentStatus.PAID;
    booking.status = EventBookingStatus.CONFIRMED;
    booking.paymentExpiresAt = undefined;
    booking.confirmedAt = new Date();
    booking.paidAt = new Date();
    booking.invoiceId = EventBookingUtility.generateInvoiceId(
      booking._id.toString(),
    );
    await booking.save();

    if (booking.organizerPayoutAmount && booking.organizerPayoutAmount > 0) {
      await this.walletService.moveAmountToEscrow(
        WalletType.EVENT,
        booking._id.toString(),
        event.createdBy.toString(),
        booking.organizerPayoutAmount,
      );
    }

    await this.eventsService.incrementRegisteredCount(eventId, 1);

    return (await booking.populate(
      EventBookingService.populateOptions,
    )) as EventBookingDocument;
  }

  async updateBooking(
    eventId: string,
    bookingId: string,
    dto: UpdateEventBookingDto,
    userId: string,
    userRole: string,
  ): Promise<EventBookingDocument> {
    const booking = await this.eventBookingModel.findById(bookingId);
    if (!booking || booking.event.toString() !== eventId) {
      throw new NotFoundException('Booking not found');
    }

    const event = await this.eventModel.findById(eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const isBooker = booking.bookedBy.toString() === userId;
    const isOrganizer = event.createdBy.toString() === userId;
    if (!isBooker && !isOrganizer) {
      throw new ForbiddenException('You can only update your own bookings');
    }

    if (dto.status) {
      EventBookingUtility.validateStatusTransition(booking.status, dto.status);
    }

    const becomingCancelled =
      dto.status === EventBookingStatus.CANCELLED &&
      booking.status !== EventBookingStatus.CANCELLED;
    const wasConfirmed =
      booking.status === EventBookingStatus.CONFIRMED ||
      booking.status === EventBookingStatus.COMPLETED;

    if (dto.status === EventBookingStatus.CANCELLED) {
      booking.cancelledAt = new Date();
      if (dto.cancelReason) {
        booking.cancelReason = dto.cancelReason;
      }
    }

    Object.assign(booking, dto);
    await booking.save();

    const organizerPayout =
      booking.organizerPayoutAmount ??
      this.rajorpayService.calculateOwnerPayoutAmount(booking.totalAmount)
        .ownerPayoutAmount;

    if (
      becomingCancelled &&
      booking.paymentStatus === PaymentStatus.PAID &&
      organizerPayout > 0
    ) {
      await this.walletService.deductEscrow(
        WalletType.EVENT,
        event.createdBy.toString(),
        organizerPayout,
      );
    }

    if (becomingCancelled && wasConfirmed) {
      await this.eventsService.incrementRegisteredCount(eventId, -1);
    }

    return (await booking.populate(
      EventBookingService.populateOptions,
    )) as EventBookingDocument;
  }

  async releaseEscrowForClosedEvent(eventId: string): Promise<void> {
    const event = await this.eventModel.findById(eventId);
    if (!event) {
      return;
    }

    const bookings = await this.eventBookingModel.find({
      event: new Types.ObjectId(eventId),
      paymentStatus: PaymentStatus.PAID,
      escrowCreditedAt: { $exists: true },
      escrowReleasedAt: { $exists: false },
    });

    for (const booking of bookings) {
      const payout =
        booking.organizerPayoutAmount ??
        this.rajorpayService.calculateOwnerPayoutAmount(booking.totalAmount)
          .ownerPayoutAmount;

      if (payout > 0) {
        await this.walletService.releaseEscrowToTotal(
          WalletType.EVENT,
          booking._id.toString(),
          event.createdBy.toString(),
          payout,
        );
      }

      if (booking.status === EventBookingStatus.CONFIRMED) {
        booking.status = EventBookingStatus.COMPLETED;
        await booking.save();
      }
    }
  }

  async findMyBooking(
    eventId: string,
    userId: string,
  ): Promise<EventBookingDocument | null> {
    const booking = await this.eventBookingModel
      .findOne({
        event: eventId,
        bookedBy: userId,
        status: { $ne: EventBookingStatus.CANCELLED },
      })
      .sort({ createdAt: -1 })
      .populate(EventBookingService.populateOptions);

    return booking;
  }

  async findByEvent(
    eventId: string,
    userId: string,
    userRole: string,
    filter: EventBookingFilterDto,
  ): Promise<PaginatedResult<EventBookingDocument>> {
    const event = await this.eventModel.findById(eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const isOrganizer = event.createdBy.toString() === userId;
    if (!isOrganizer && userRole !== UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException('Access denied');
    }

    const { status, paymentStatus, page = 1, limit = 10 } = filter;
    const query: Record<string, unknown> = { event: eventId };
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const skip = (page - 1) * limit;
    const [data, totalDocuments] = await Promise.all([
      this.eventBookingModel
        .find(query)
        .populate(EventBookingService.populateOptions)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.eventBookingModel.countDocuments(query),
    ]);

    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async checkCapacity(
    eventId: string,
    playerCount: number,
  ): Promise<{ available: boolean; remaining: number }> {
    const event = await this.eventsService.getPublishedEventForBooking(eventId);
    const pending = await this.countActivePendingBookings(eventId);
    const used = event.registeredCount + pending;
    const remaining = Math.max(0, event.maxParticipants - used);
    return {
      available: used + playerCount <= event.maxParticipants,
      remaining,
    };
  }

  async releaseExpiredPaymentHolds(): Promise<void> {
    const now = new Date();
    const expired = await this.eventBookingModel.find({
      status: EventBookingStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      paymentExpiresAt: { $lte: now },
    });

    for (const booking of expired) {
      booking.status = EventBookingStatus.CANCELLED;
      booking.cancelledAt = new Date();
      booking.cancelReason = 'Payment hold expired';
      booking.paymentExpiresAt = undefined;
      await booking.save();
    }
  }

  private async assertCapacityAvailable(
    event: EventDocument,
    slots: number,
    excludeBookingId?: string,
  ): Promise<void> {
    const pending = await this.countActivePendingBookings(
      event._id.toString(),
      excludeBookingId,
    );
    if (event.registeredCount + pending + slots > event.maxParticipants) {
      throw new BadRequestException('Event is at full capacity');
    }
  }

  private async countActivePendingBookings(
    eventId: string,
    excludeBookingId?: string,
  ): Promise<number> {
    const now = new Date();
    return this.eventBookingModel.countDocuments({
      event: eventId,
      status: EventBookingStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      paymentExpiresAt: { $gt: now },
      ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
    });
  }
}
