import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EventBooking,
  EventBookingSchema,
} from './schemas/event-booking.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { EventBookingController } from './event-booking.controller';
import { EventBookingService } from './event-booking.service';
import { EventsModule } from '../events/events.module';
import { WalletModule } from '../wallet/wallet.module';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EventBooking.name, schema: EventBookingSchema },
      { name: Event.name, schema: EventSchema },
    ]),
    forwardRef(() => EventsModule),
    WalletModule,
  ],
  controllers: [EventBookingController],
  providers: [EventBookingService, RajorpayService],
  exports: [EventBookingService],
})
export class EventBookingModule {}
