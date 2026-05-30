import { BadRequestException, Injectable } from '@nestjs/common';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { TurfBookingService } from '../turf-booking/turf-booking.service';
import { RazorpayWebhookPayloadDto } from './dto/razorpay-webhook.dto';
import { TurfBookingWebhookService } from './turf-booking-webhook.service';

@Injectable()
export class RazorpayWebhookService {
  constructor(
    private readonly rajorpayService: RajorpayService,
    private readonly turfBookingWebhookService: TurfBookingWebhookService,
    private readonly turfBookingService: TurfBookingService,
  ) {}

  async handleRazorpayWebhook(
    webhookPayload: RazorpayWebhookPayloadDto,
    rawWebhookPayload: string,
    webhookSignature: string | undefined,
  ): Promise<{ processed: boolean; message: string }> {
    await this.turfBookingService.releaseExpiredSlotHolds();
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

    return this.turfBookingWebhookService.processWebhookEvent(webhookPayload);
  }
}
