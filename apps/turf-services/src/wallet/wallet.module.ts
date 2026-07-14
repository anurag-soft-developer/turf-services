import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EventBooking,
  EventBookingSchema,
} from '../event-booking/schemas/event-booking.schema';
import {
  TurfBooking,
  TurfBookingSchema,
} from '../turf-booking/schemas/turf-booking.schema';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: TurfBooking.name, schema: TurfBookingSchema },
      { name: EventBooking.name, schema: EventBookingSchema },
    ]),
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
