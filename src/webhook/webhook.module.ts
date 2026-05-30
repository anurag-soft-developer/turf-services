import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurfBookingModule } from '../turf-booking/turf-booking.module';
import { TurfBooking, TurfBookingSchema } from '../turf-booking/schemas/turf-booking.schema';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { TurfBookingWebhookService } from './turf-booking-webhook.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { Turf, TurfSchema } from '../turf/schemas/turf.schema';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TurfBooking.name, schema: TurfBookingSchema },
      { name: Turf.name, schema: TurfSchema },
    ]),
    TurfBookingModule,
    WalletModule,
  ],
  controllers: [RazorpayWebhookController],
  providers: [
    RajorpayService,
    TurfBookingWebhookService,
    RazorpayWebhookService,
  ],
})
export class WebhookModule {}
