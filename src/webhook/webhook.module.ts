import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurfBookingModule } from '../turf-booking/turf-booking.module';
import { TurfBooking, TurfBookingSchema } from '../turf-booking/schemas/turf-booking.schema';
import { Turf, TurfSchema } from '../turf/schemas/turf.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { TurfBookingWebhookService } from './turf-booking-webhook.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { UsersModule } from '../users/users.module';
import { HostOnboardingWebhookService } from './host-onboarding-webhook.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TurfBooking.name, schema: TurfBookingSchema },
      { name: Turf.name, schema: TurfSchema },
      { name: User.name, schema: UserSchema },
    ]),
    TurfBookingModule,
    UsersModule,
  ],
  controllers: [RazorpayWebhookController],
  providers: [
    RajorpayService,
    TurfBookingWebhookService,
    HostOnboardingWebhookService,
    RazorpayWebhookService,
  ],
})
export class WebhookModule {}
