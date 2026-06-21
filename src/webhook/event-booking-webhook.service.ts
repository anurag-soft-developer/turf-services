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
import { RazorpayWebhookPayloadDto } from './dto/razorpay-webhook.dto';
import { EventBookingService } from '../event-booking/event-booking.service';

@Injectable()
export class EventBookingWebhookService {
  constructor(
    @InjectModel(EventBooking.name)
    private readonly eventBookingModel: Model<EventBookingDocument>,
    private readonly eventBookingService: EventBookingService,
  ) {}

  async processWebhookEvent(eventPayload: RazorpayWebhookPayloadDto): Promise<{
    processed: boolean;
    message: string;
  }> {
    const eventType = eventPayload.event;

    if (eventType === 'payment_link.paid') {
      const applied = await this.applyPaymentLinkPaidWebhook(eventPayload);
      return {
        processed: applied,
        message: applied ? `${eventType} processed` : `${eventType} not matched`,
      };
    }

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

  private async applyPaymentLinkPaidWebhook(
    payload: RazorpayWebhookPayloadDto,
  ): Promise<boolean> {
    const linkEntity = (
      payload.payload?.payment_link as
        | { entity?: Record<string, unknown> }
        | undefined
    )?.entity;
    const paymentEntity = (
      payload.payload?.payment as { entity?: Record<string, unknown> } | undefined
    )?.entity;

    const paymentLinkId =
      typeof linkEntity?.id === 'string' ? linkEntity.id : undefined;
    const paymentId =
      typeof paymentEntity?.id === 'string' ? paymentEntity.id : undefined;

    if (!paymentLinkId || !paymentId) {
      return false;
    }

    const bookingExists = await this.eventBookingModel.exists({
      razorpayPaymentLinkId: paymentLinkId,
    });
    if (!bookingExists) {
      return false;
    }

    await this.eventBookingService.confirmPaidBookingByPaymentLinkId(
      paymentLinkId,
      paymentId,
    );

    return true;
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

    const bookingExists = await this.eventBookingModel.exists({
      razorpayOrderId: orderId,
    });
    if (!bookingExists) {
      return false;
    }

    await this.eventBookingService.confirmPaidBookingByOrderId(
      orderId,
      paymentId,
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

    const booking = await this.eventBookingModel.findOne({ razorpayPaymentId: paymentId });
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
