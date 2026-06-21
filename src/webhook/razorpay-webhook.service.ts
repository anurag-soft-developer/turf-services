import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { TurfBookingService } from '../turf-booking/turf-booking.service';
import {
  TurfBooking,
  TurfBookingDocument,
} from '../turf-booking/schemas/turf-booking.schema';
import {
  EventBooking,
  EventBookingDocument,
} from '../event-booking/schemas/event-booking.schema';
import { RazorpayWebhookPayloadDto } from './dto/razorpay-webhook.dto';
import { TurfBookingWebhookService } from './turf-booking-webhook.service';
import { EventBookingWebhookService } from './event-booking-webhook.service';
import { EventBookingService } from '../event-booking/event-booking.service';

@Injectable()
export class RazorpayWebhookService {
  constructor(
    private readonly rajorpayService: RajorpayService,
    private readonly turfBookingWebhookService: TurfBookingWebhookService,
    private readonly eventBookingWebhookService: EventBookingWebhookService,
    private readonly turfBookingService: TurfBookingService,
    private readonly eventBookingService: EventBookingService,
    @InjectModel(TurfBooking.name)
    private readonly turfBookingModel: Model<TurfBookingDocument>,
    @InjectModel(EventBooking.name)
    private readonly eventBookingModel: Model<EventBookingDocument>,
  ) {}

  async handleRazorpayWebhook(
    webhookPayload: RazorpayWebhookPayloadDto,
    rawWebhookPayload: string,
    webhookSignature: string | undefined,
  ): Promise<{ processed: boolean; message: string }> {
    await this.turfBookingService.releaseExpiredSlotHolds();
    await this.eventBookingService.releaseExpiredPaymentHolds();

    if (!webhookSignature) {
      throw new BadRequestException('Missing webhook signature');
    }
    if (!rawWebhookPayload) {
      throw new BadRequestException('Missing raw webhook payload');
    }

    const isValidSignature = this.rajorpayService.verifyWebhookSignature(
      rawWebhookPayload,
      webhookSignature,
    );
    if (!isValidSignature) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const orderId = this.extractOrderId(webhookPayload);
    const paymentLinkId = this.extractPaymentLinkId(webhookPayload);

    if (paymentLinkId) {
      const eventBooking = await this.eventBookingModel.exists({
        razorpayPaymentLinkId: paymentLinkId,
      });
      if (eventBooking) {
        return this.eventBookingWebhookService.processWebhookEvent(
          webhookPayload,
        );
      }
    }

    if (orderId) {
      const turfBooking = await this.turfBookingModel.exists({
        razorpayOrderId: orderId,
      });
      if (turfBooking) {
        return this.turfBookingWebhookService.processWebhookEvent(webhookPayload);
      }

      const eventBooking = await this.eventBookingModel.exists({
        razorpayOrderId: orderId,
      });
      if (eventBooking) {
        return this.eventBookingWebhookService.processWebhookEvent(
          webhookPayload,
        );
      }
    }

    const turfResult =
      await this.turfBookingWebhookService.processWebhookEvent(webhookPayload);
    if (turfResult.processed) {
      return turfResult;
    }

    return this.eventBookingWebhookService.processWebhookEvent(webhookPayload);
  }

  private extractOrderId(
    payload: RazorpayWebhookPayloadDto,
  ): string | undefined {
    const paymentEntity = (
      payload.payload?.payment as { entity?: Record<string, unknown> } | undefined
    )?.entity;
    const orderId = paymentEntity?.order_id;
    return typeof orderId === 'string' ? orderId : undefined;
  }

  private extractPaymentLinkId(
    payload: RazorpayWebhookPayloadDto,
  ): string | undefined {
    const linkEntity = (
      payload.payload?.payment_link as
        | { entity?: Record<string, unknown> }
        | undefined
    )?.entity;
    const paymentLinkId = linkEntity?.id;
    return typeof paymentLinkId === 'string' ? paymentLinkId : undefined;
  }
}
