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
  VerifyEventRazorpayHostedPaymentDto,
  VerifyEventRazorpayPaymentDto,
} from './dto/event-booking.dto';
import {
  EventBookingStatus,
  PaymentStatus,
} from './interfaces/event-booking.interface';
import { EventsService } from '../events/events.service';
import {
  Event,
  EventDocument,
  eventSelectFields,
} from '../events/schemas/event.schema';
import { PaginatedResult } from '../core/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletType } from '../wallet/interfaces/wallet.interface';
import { EventBookingUtility } from './utility/event-booking.utility';
import { IRajorpayOrder } from '../core/interfaces/rajorpay.interface';
import { UserRole } from '../auth/decorators/roles.decorator';
import { NotificationService } from '../notification/notification.service';
import {
  notifyBookerEventPaymentFailed,
  notifyEventBookingCancelledParty,
  notifyEventBookingConfirmedParties,
} from './utility/event-booking-notification.utility';
import { config } from '../core/config/env.config';
import { resolveId } from '../core/utils/mongo-ref.util';
import * as UserInterface from '../users/interfaces/user.interface';

function emptyPaginatedResult(
  page: number,
  limit: number,
): PaginatedResult<EventBookingDocument> {
  return {
    data: [],
    totalDocuments: 0,
    page,
    limit,
    totalPages: 0,
  };
}

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
    private readonly notificationService: NotificationService,
  ) {}

  async createBookingOrder(
    eventId: string,
    dto: CreateEventBookingDto,
    user: UserInterface.IUser,
    paymentLink = false,
  ): Promise<{
    booking: EventBookingDocument;
    order?: IRajorpayOrder;
    paymentLink?: { id: string; shortUrl: string; callbackUrl: string };
  }> {
    await this.releaseExpiredPaymentHolds();
    const userId = user._id.toString();
    const event = await this.eventsService.getPublishedEventForBooking(eventId);

    const existingBooking = await this.eventBookingModel.findOne({
      event: eventId,
      bookedBy: userId,
      status: { $ne: EventBookingStatus.CANCELLED },
    });

    if (
      existingBooking &&
      (existingBooking.status === EventBookingStatus.CONFIRMED ||
        existingBooking.status === EventBookingStatus.COMPLETED)
    ) {
      throw new BadRequestException(
        'You already have a booking for this event',
      );
    }

    let booking: EventBookingDocument;

    if (
      existingBooking &&
      existingBooking.status === EventBookingStatus.PENDING
    ) {
      if (EventBookingUtility.isPaymentHoldExpired(existingBooking)) {
        throw new BadRequestException(
          'Booking hold expired. Please create a new booking order.',
        );
      }

      existingBooking.fullName = dto.fullName;
      existingBooking.contactNumber = dto.contactNumber;
      existingBooking.notes = dto.notes;
      existingBooking.playerCount = dto.playerCount;
      booking = await existingBooking.save();
    } else {
      await EventBookingUtility.assertCapacityAvailable(
        this.eventBookingModel,
        event,
        1,
      );

      const totalAmount = event.price;
      const { ownerPayoutAmount: organizerPayoutAmount, platformFeeAmount } =
        this.rajorpayService.calculateOwnerPayoutAmount(totalAmount);

      booking = await new this.eventBookingModel({
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
      }).save();
    }

    const totalAmount = booking.totalAmount;

    if (totalAmount <= 0) {
      booking.paymentStatus = PaymentStatus.PAID;
      booking.status = EventBookingStatus.CONFIRMED;
      booking.confirmedAt = new Date();
      booking.paymentExpiresAt = undefined;
      booking.bookingId = EventBookingUtility.generateBookingId(
        booking._id.toString(),
      );
      await booking.save();
      await this.eventsService.incrementRegisteredCount(eventId, 1);
      await notifyEventBookingConfirmedParties(
        this.notificationService,
        this.eventModel,
        booking,
      );
      return {
        booking: (await booking.populate(
          EventBookingService.populateOptions,
        )) as EventBookingDocument,
      };
    }

    const bookingId = booking._id.toString();

    if (paymentLink) {
      booking.razorpayOrderId = undefined;

      const callbackUrl = `${config.FRONTEND_URL}/payments/razorpay/callback?eventId=${encodeURIComponent(eventId)}&bookingId=${encodeURIComponent(bookingId)}&eventSlug=${encodeURIComponent(event.slug)}`;
      const minExpireBy =
        Math.floor(Date.now() / 1000) +
        RajorpayService.PAYMENT_LINK_MIN_EXPIRY_SECONDS;
      const expireBy = Math.max(
        booking.paymentExpiresAt
          ? Math.floor(new Date(booking.paymentExpiresAt).getTime() / 1000)
          : minExpireBy,
        minExpireBy,
      );
      const amountInPaise = Math.round(totalAmount * 100);

      const resolvedPaymentLink =
        await EventBookingUtility.resolveOrCreateRazorpayPaymentLink(
          this.rajorpayService,
          booking,
          user,
          eventId,
          bookingId,
          amountInPaise,
          callbackUrl,
          expireBy,
        );

      return {
        booking: (await booking.populate(
          EventBookingService.populateOptions,
        )) as EventBookingDocument,
        paymentLink: resolvedPaymentLink,
      };
    }

    const order = await this.rajorpayService.createOrder(
      totalAmount,
      `event_booking_${bookingId}`,
    );
    booking.razorpayOrderId = order.id;
    booking.razorpayPaymentLinkId = undefined;
    booking.razorpayPaymentLinkShortUrl = undefined;
    booking.razorpayPaymentLinkCallbackUrl = undefined;
    await booking.save();

    return {
      booking: (await booking.populate(
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
    if (!booking || resolveId(booking.event) !== eventId) {
      throw new NotFoundException('Booking not found');
    }

    if (resolveId(booking.bookedBy) !== resolveId(userId)) {
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

    if (EventBookingUtility.isPaymentHoldExpired(booking)) {
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
    await EventBookingUtility.assertCapacityAvailable(
      this.eventBookingModel,
      event,
      1,
      booking._id.toString(),
    );

    await EventBookingUtility.confirmPaidBooking(
      this.walletService,
      this.eventsService,
      booking,
      event,
      dto.razorpay_order_id,
      dto.razorpay_payment_id,
    );

    await notifyEventBookingConfirmedParties(
      this.notificationService,
      this.eventModel,
      booking,
    );

    return (await booking.populate(
      EventBookingService.populateOptions,
    )) as EventBookingDocument;
  }

  async verifyHostedPayment(
    eventId: string,
    dto: VerifyEventRazorpayHostedPaymentDto,
    userId: string,
  ): Promise<EventBookingDocument> {
    await this.releaseExpiredPaymentHolds();

    const booking = await this.eventBookingModel.findById(dto.bookingId);
    if (!booking || resolveId(booking.event) !== eventId) {
      throw new NotFoundException('Booking not found');
    }

    if (resolveId(booking.bookedBy) !== resolveId(userId)) {
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

    if (EventBookingUtility.isPaymentHoldExpired(booking)) {
      throw new BadRequestException(
        'Booking hold expired. Please create a new booking order.',
      );
    }

    if (dto.razorpay_payment_link_status !== 'paid') {
      throw new BadRequestException('Payment was not completed');
    }

    if (
      booking.razorpayPaymentLinkId &&
      booking.razorpayPaymentLinkId !== dto.razorpay_payment_link_id
    ) {
      throw new BadRequestException('Payment link does not match this booking');
    }

    const isValidSignature = this.rajorpayService.verifyPaymentLinkSignature({
      paymentLinkId: dto.razorpay_payment_link_id,
      referenceId: dto.razorpay_payment_link_reference_id,
      status: dto.razorpay_payment_link_status,
      paymentId: dto.razorpay_payment_id,
      signature: dto.razorpay_signature,
    });
    if (!isValidSignature) {
      throw new BadRequestException('Invalid payment signature');
    }

    const confirmed =
      await EventBookingUtility.confirmPaidBookingFromPaymentLink(
        this.eventBookingModel,
        this.eventModel,
        this.rajorpayService,
        this.walletService,
        this.eventsService,
        booking,
        dto.razorpay_payment_link_id,
        dto.razorpay_payment_id,
      );
    if (!confirmed) {
      throw new BadRequestException('Payment was not completed');
    }

    return (await booking.populate(
      EventBookingService.populateOptions,
    )) as EventBookingDocument;
  }

  async confirmPaidBookingByPaymentLinkId(
    paymentLinkId: string,
    razorpayPaymentId: string,
  ): Promise<void> {
    const booking = await this.eventBookingModel.findOne({
      razorpayPaymentLinkId: paymentLinkId,
      status: EventBookingStatus.PENDING,
    });

    if (!booking || booking.paymentStatus === PaymentStatus.PAID) {
      return;
    }

    await EventBookingUtility.confirmPaidBookingFromPaymentLink(
      this.eventBookingModel,
      this.eventModel,
      this.rajorpayService,
      this.walletService,
      this.eventsService,
      booking,
      paymentLinkId,
      razorpayPaymentId,
    );

    await notifyEventBookingConfirmedParties(
      this.notificationService,
      this.eventModel,
      booking,
    );
  }

  async confirmPaidBookingByOrderId(
    orderId: string,
    razorpayPaymentId: string,
  ): Promise<void> {
    const booking = await this.eventBookingModel.findOne({
      razorpayOrderId: orderId,
    });

    if (!booking || booking.paymentStatus === PaymentStatus.PAID) {
      return;
    }

    if (booking.status !== EventBookingStatus.PENDING) {
      return;
    }

    const event = await this.eventModel.findById(booking.event);
    if (!event) {
      return;
    }

    await EventBookingUtility.confirmPaidBooking(
      this.walletService,
      this.eventsService,
      booking,
      event,
      orderId,
      razorpayPaymentId,
    );

    await notifyEventBookingConfirmedParties(
      this.notificationService,
      this.eventModel,
      booking,
    );
  }

  async updateBooking(
    eventId: string,
    bookingId: string,
    dto: UpdateEventBookingDto,
    userId: string,
    userRole: string,
  ): Promise<EventBookingDocument> {
    const booking = await this.eventBookingModel.findById(bookingId);
    if (!booking || resolveId(booking.event) !== eventId) {
      throw new NotFoundException('Booking not found');
    }

    const event = await this.eventModel.findById(eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const isBooker = resolveId(booking.bookedBy) === resolveId(userId);
    const isOrganizer = resolveId(event.createdBy) === resolveId(userId);
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

    if (becomingCancelled) {
      if (isOrganizer && !isBooker) {
        await notifyEventBookingCancelledParty(this.notificationService, {
          recipientUserId: booking.bookedBy.toString(),
          bookingId: booking._id.toString(),
          eventId,
          eventTitle: event.title,
          cancelledBy: 'organizer',
        });
      } else if (isBooker && !isOrganizer) {
        await notifyEventBookingCancelledParty(this.notificationService, {
          recipientUserId: event.createdBy.toString(),
          bookingId: booking._id.toString(),
          eventId,
          eventTitle: event.title,
          cancelledBy: 'booker',
        });
      }
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

  async findUserBookings(
    userId: string,
    filter: EventBookingFilterDto,
  ): Promise<PaginatedResult<EventBookingDocument>> {
    const {
      page = 1,
      limit = 10,
      status,
      paymentStatus,
      sortOrder = 'desc',
    } = filter;

    const query: Record<string, unknown> = { bookedBy: userId };
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 } as const;
    const skip = (page - 1) * limit;

    const [data, totalDocuments] = await Promise.all([
      this.eventBookingModel
        .find(query)
        .populate(EventBookingService.populateOptions)
        .sort(sort)
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

    const isOrganizer = resolveId(event.createdBy) === resolveId(userId);
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

  async findOrganizerBookings(
    ownerId: string,
    filter: EventBookingFilterDto,
  ): Promise<PaginatedResult<EventBookingDocument>> {
    const ownedEvents = await this.eventModel
      .find({ createdBy: ownerId })
      .select('_id');
    const eventIds = ownedEvents.map((event) => event._id);

    const { page = 1, limit = 10 } = filter;
    if (eventIds.length === 0) {
      return emptyPaginatedResult(page, limit);
    }

    const {
      status,
      paymentStatus,
      event,
      startDate,
      endDate,
      sortOrder = 'desc',
    } = filter;
    const query: Record<string, unknown> = { event: { $in: eventIds } };
    const ownedEventIdSet = new Set(eventIds.map((id) => resolveId(id)));

    if (status?.length) {
      query.status = status.length === 1 ? status[0] : { $in: status };
    }
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (event?.length) {
      const ownedRequested = event.filter((id) =>
        ownedEventIdSet.has(resolveId(id)),
      );
      if (ownedRequested.length === 0) {
        return emptyPaginatedResult(page, limit);
      }
      query.event = ownedRequested;
    }
    if (startDate || endDate) {
      const createdAtFilter: Record<string, Date> = {};
      if (startDate) createdAtFilter.$gte = startDate;
      if (endDate) createdAtFilter.$lte = endDate;
      query.createdAt = createdAtFilter;
    }
    const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 } as const;
    const skip = (page - 1) * limit;

    const [data, totalDocuments] = await Promise.all([
      this.eventBookingModel
        .find(query)
        .populate(EventBookingService.populateOptions)
        .sort(sort)
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

  async findOrganizerBookingById(
    id: string,
    userId: string,
    userRole: string,
  ): Promise<EventBookingDocument> {
    const booking = await this.eventBookingModel.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    await EventBookingUtility.assertOrganizerAccess(
      this.eventModel,
      booking.event.toString(),
      userId,
      userRole,
    );

    return (await booking.populate(
      EventBookingService.populateOptions,
    )) as EventBookingDocument;
  }

  async updateOrganizerBooking(
    id: string,
    dto: UpdateEventBookingDto,
    userId: string,
    userRole: string,
  ): Promise<EventBookingDocument> {
    const booking = await this.eventBookingModel.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    await EventBookingUtility.assertOrganizerAccess(
      this.eventModel,
      booking.event.toString(),
      userId,
      userRole,
    );

    return this.updateBooking(
      booking.event.toString(),
      id,
      dto,
      userId,
      userRole,
    );
  }

  async checkCapacity(
    eventId: string,
    playerCount: number,
  ): Promise<{ available: boolean; remaining: number }> {
    const event = await this.eventsService.getPublishedEventForBooking(eventId);
    const pending = await EventBookingUtility.countActivePendingBookings(
      this.eventBookingModel,
      eventId,
    );
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

      const event = await this.eventModel
        .findById(booking.event)
        .select('title')
        .lean();
      if (event) {
        await notifyBookerEventPaymentFailed(
          this.notificationService,
          booking,
          event.title,
          'hold_expired',
        );
      }
    }
  }
}
