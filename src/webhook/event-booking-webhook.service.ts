import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PaymentStatus,
  EventBookingStatus,
} from '../event-booking/interfaces/event-booking.interface';
import {
  EventBooking,
  EventBookingDocument,
} from '../event-booking/schemas/event-booking.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
import { RazorpayWebhookPayloadDto } from './dto/razorpay-webhook.dto';
import { WalletService } from '../wallet/wallet.service';
import { WalletType } from '../wallet/interfaces/wallet.interface';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { EventsService } from '../events/events.service';
import { EventBookingUtility } from '../event-booking/utility/event-booking.utility';

@Injectable()
export class EventBookingWebhookService {
  constructor(
    @InjectModel(EventBooking.name)
    private readonly eventBookingModel: Model<EventBookingDocument>,
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
    private readonly walletService: WalletService,
    private readonly rajorpayService: RajorpayService,
    private readonly eventsService: EventsService,
  ) {}

  async processWebhookEvent(eventPayload: RazorpayWebhookPayloadDto): Promise<{
    processed: boolean;
    message: string;
  }> {
    const eventType = eventPayload.event;
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const applied = await this.applyCapturedPaymentWebhook(eventPayload);
      return {
        processed: applied,
        message: applied ? `${eventType} processed` : `${eventType} not matched`,
      };
    }

    if (eventType === 'payment.failed') {
      const applied = await this.applyFailedPaymentWebhook(eventPayload);
      return {
        processed: applied,
        message: applied ? 'payment.failed processed' : 'payment.failed not matched',
      };
    }

    if (eventType === 'refund.processed' || eventType === 'refund.failed') {
      const applied = await this.applyRefundWebhook(eventPayload);
      return {
        processed: applied,
        message: applied ? `${eventType} processed` : `${eventType} not matched`,
      };
    }

    return { processed: false, message: `Event ${eventType} ignored` };
  }

  private async applyCapturedPaymentWebhook(
    payload: RazorpayWebhookPayloadDto,
  ): Promise<boolean> {
    const paymentEntity = (
      payload.payload?.payment as { entity?: Record<string, unknown> } | undefined
    )?.entity;
    const orderId =
      typeof paymentEntity?.order_id === 'string'
        ? paymentEntity.order_id
        : undefined;
    const paymentId =
      typeof paymentEntity?.id === 'string' ? paymentEntity.id : undefined;
    if (!orderId || !paymentId) {
      return false;
    }

    const booking = await this.eventBookingModel.findOne({
      razorpayOrderId: orderId,
    });
    if (!booking || booking.paymentStatus === PaymentStatus.PAID) {
      return false;
    }

    if (booking.status !== EventBookingStatus.PENDING) {
      return false;
    }

    const event = await this.eventModel.findById(booking.event);
    if (!event) {
      return false;
    }

    booking.paymentId = paymentId;
    booking.paymentStatus = PaymentStatus.PAID;
    booking.status = EventBookingStatus.CONFIRMED;
    booking.confirmedAt = new Date();
    booking.paidAt = new Date();
    booking.paymentExpiresAt = undefined;
    booking.invoiceId =
      booking.invoiceId ||
      EventBookingUtility.generateInvoiceId(booking._id.toString());
    await booking.save();

    const payout =
      booking.organizerPayoutAmount ??
      this.rajorpayService.calculateOwnerPayoutAmount(booking.totalAmount)
        .ownerPayoutAmount;

    if (payout > 0) {
      await this.walletService.moveAmountToEscrow(
        WalletType.EVENT,
        booking._id.toString(),
        event.createdBy.toString(),
        payout,
      );
    }

    await this.eventsService.incrementRegisteredCount(
      booking.event.toString(),
      1,
    );

    return true;
  }

  private async applyFailedPaymentWebhook(
    payload: RazorpayWebhookPayloadDto,
  ): Promise<boolean> {
    const paymentEntity = (
      payload.payload?.payment as { entity?: Record<string, unknown> } | undefined
    )?.entity;
    const orderId =
      typeof paymentEntity?.order_id === 'string'
        ? paymentEntity.order_id
        : undefined;
    if (!orderId) {
      return false;
    }

    const booking = await this.eventBookingModel.findOne({
      razorpayOrderId: orderId,
    });
    if (!booking || booking.status !== EventBookingStatus.PENDING) {
      return false;
    }

    booking.paymentStatus = PaymentStatus.FAILED;
    booking.status = EventBookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancelReason = 'Payment failed via Razorpay webhook';
    booking.paymentExpiresAt = undefined;
    await booking.save();
    return true;
  }

  private async applyRefundWebhook(
    payload: RazorpayWebhookPayloadDto,
  ): Promise<boolean> {
    const refundEntity = (
      payload.payload?.refund as
        | { entity?: Record<string, unknown> }
        | undefined
    )?.entity;
    if (!refundEntity) {
      return false;
    }
    const paymentId =
      typeof refundEntity.payment_id === 'string'
        ? refundEntity.payment_id
        : undefined;
    if (!paymentId) {
      return false;
    }

    const booking = await this.eventBookingModel.findOne({ paymentId });
    if (!booking) {
      return false;
    }

    if (payload.event === 'refund.processed') {
      booking.paymentStatus = PaymentStatus.REFUNDED;
      booking.refundId =
        typeof refundEntity.id === 'string'
          ? refundEntity.id
          : booking.refundId;
      booking.refundedAt = new Date();
      booking.refundAmount =
        typeof refundEntity.amount === 'number'
          ? Math.round((refundEntity.amount / 100) * 100) / 100
          : booking.refundAmount;
    }

    await booking.save();
    return true;
  }
}
