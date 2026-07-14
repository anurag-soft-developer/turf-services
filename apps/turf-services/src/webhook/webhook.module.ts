import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurfBookingModule } from '../turf-booking/turf-booking.module';
import { EventBookingModule } from '../event-booking/event-booking.module';
import { EventsModule } from '../events/events.module';
import {
  TurfBooking,
  TurfBookingSchema,
} from '../turf-booking/schemas/turf-booking.schema';
import {
  EventBooking,
  EventBookingSchema,
} from '../event-booking/schemas/event-booking.schema';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { TurfBookingWebhookService } from './turf-booking-webhook.service';
import { EventBookingWebhookService } from './event-booking-webhook.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { Turf, TurfSchema } from '../turf/schemas/turf.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TurfBooking.name, schema: TurfBookingSchema },
      { name: Turf.name, schema: TurfSchema },
      { name: EventBooking.name, schema: EventBookingSchema },
      { name: Event.name, schema: EventSchema },
    ]),
    TurfBookingModule,
    EventBookingModule,
    EventsModule,
    WalletModule,
    NotificationModule,
  ],
  controllers: [RazorpayWebhookController],
  providers: [
    RajorpayService,
    TurfBookingWebhookService,
    EventBookingWebhookService,
    RazorpayWebhookService,
  ],
})
export class WebhookModule {}
