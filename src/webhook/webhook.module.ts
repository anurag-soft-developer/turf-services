import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurfBookingModule } from '../turf-booking/turf-booking.module';
import { TurfBooking, TurfBookingSchema } from '../turf-booking/schemas/turf-booking.schema';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { TurfBookingWebhookService } from './turf-booking-webhook.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';
import { RazorpayWebhookController } from './razorpay-webhook.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TurfBooking.name, schema: TurfBookingSchema },
    ]),
    TurfBookingModule,
  ],
  controllers: [RazorpayWebhookController],
  providers: [RajorpayService, TurfBookingWebhookService, RazorpayWebhookService],
})
export class WebhookModule {}
