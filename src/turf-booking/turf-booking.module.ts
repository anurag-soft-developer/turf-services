import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurfBookingService } from './turf-booking.service';
import { TurfBookingController } from './turf-booking.controller';
import {
  TurfBooking,
  TurfBookingSchema,
} from './schemas/turf-booking.schema';
import { Turf, TurfSchema } from '../turf/schemas/turf.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TurfBooking.name, schema: TurfBookingSchema },
      { name: Turf.name, schema: TurfSchema },
    ]),
  ],
  controllers: [TurfBookingController],
  providers: [TurfBookingService],
  exports: [TurfBookingService],
})
export class TurfBookingModule {}