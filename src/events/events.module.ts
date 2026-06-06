import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Event, EventSchema } from './schemas/event.schema';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventApprovalService } from './event-approvals/event-approval.service';
import { UsersModule } from '../users/users.module';
import { EventBookingModule } from '../event-booking/event-booking.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Event.name, schema: EventSchema }]),
    UsersModule,
    forwardRef(() => EventBookingModule),
  ],
  controllers: [EventsController],
  providers: [EventsService, EventApprovalService],
  exports: [EventsService],
})
export class EventsModule {}
