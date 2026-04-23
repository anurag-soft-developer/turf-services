import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PaymentStatus,
  SlotHoldStatus,
  TurfBookingStatus,
} from '../turf-booking/interfaces/turf-booking.interface';
import {
  TurfBooking,
  TurfBookingDocument,
} from '../turf-booking/schemas/turf-booking.schema';
import { RazorpayWebhookPayloadDto } from './dto/razorpay-webhook.dto';

@Injectable()
export class TurfBookingWebhookService {
  constructor(
    @InjectModel(TurfBooking.name)
    private turfBookingModel: Model<TurfBookingDocument>,
  ) {}

  async processWebhookEvent(eventPayload: RazorpayWebhookPayloadDto): Promise<{
    processed: boolean;
    message: string;
  }> {
    const eventType = eventPayload.event;
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      await this.applyCapturedPaymentWebhook(eventPayload);
      return { processed: true, message: `${eventType} processed` };
    }

    if (eventType === 'payment.failed') {
      await this.applyFailedPaymentWebhook(eventPayload);
      return { processed: true, message: 'payment.failed processed' };
    }

    if (eventType === 'refund.processed' || eventType === 'refund.failed') {
      await this.applyRefundWebhook(eventPayload);
      return { processed: true, message: `${eventType} processed` };
    }

    return { processed: false, message: `Event ${eventType} ignored` };
  }

  private async applyCapturedPaymentWebhook(
    payload: RazorpayWebhookPayloadDto,
  ): Promise<void> {
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
      return;
    }

    const booking = await this.turfBookingModel.findOne({ razorpayOrderId: orderId });
    if (!booking || booking.paymentStatus === PaymentStatus.PAID) {
      return;
    }

    if (booking.status !== TurfBookingStatus.PENDING) {
      return;
    }

    booking.paymentId = paymentId;
    booking.paymentStatus = PaymentStatus.PAID;
    booking.status = TurfBookingStatus.CONFIRMED;
    booking.confirmedAt = new Date();
    booking.paidAt = new Date();
    booking.slotHoldStatus = SlotHoldStatus.RELEASED;
    booking.paymentExpiresAt = undefined;
    booking.invoiceId = booking.invoiceId || this.generateInvoiceId(booking._id.toString());
    await booking.save();
  }

  private async applyFailedPaymentWebhook(
    payload: RazorpayWebhookPayloadDto,
  ): Promise<void> {
    const paymentEntity = (
      payload.payload?.payment as { entity?: Record<string, unknown> } | undefined
    )?.entity;
    const orderId =
      typeof paymentEntity?.order_id === 'string'
        ? paymentEntity.order_id
        : undefined;
    if (!orderId) {
      return;
    }

    const booking = await this.turfBookingModel.findOne({
      razorpayOrderId: orderId,
    });
    if (!booking || booking.status !== TurfBookingStatus.PENDING) {
      return;
    }

    booking.paymentStatus = PaymentStatus.FAILED;
    booking.status = TurfBookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancelReason = 'Payment failed via Razorpay webhook';
    booking.slotHoldStatus = SlotHoldStatus.RELEASED;
    booking.paymentExpiresAt = undefined;
    await booking.save();
  }

  private async applyRefundWebhook(
    payload: RazorpayWebhookPayloadDto,
  ): Promise<void> {
    const refundEntity = (
      payload.payload?.refund as
        | { entity?: Record<string, unknown> }
        | undefined
    )?.entity;
    if (!refundEntity) {
      return;
    }
    const paymentId =
      typeof refundEntity.payment_id === 'string'
        ? refundEntity.payment_id
        : undefined;
    if (!paymentId) {
      return;
    }

    const booking = await this.turfBookingModel.findOne({ paymentId });
    if (!booking) {
      return;
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
  }

  private generateInvoiceId(bookingId: string): string {
    const now = new Date();
    const datePrefix = `${now.getFullYear()}${`${now.getMonth() + 1}`.padStart(
      2,
      '0',
    )}${`${now.getDate()}`.padStart(2, '0')}`;
    return `INV-${datePrefix}-${bookingId.slice(-6).toUpperCase()}`;
  }
}
