import { Module } from '@nestjs/common';
import { EngagementModule } from '../engagement/engagement.module';
import { EventBookingModule } from '../event-booking/event-booking.module';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { StorageModule } from '../storage/storage.module';
import { InvitationModule } from '../invitations/invitation.module';
import { TurfBookingModule } from '../turf-booking/turf-booking.module';
import { InternalJobsController } from './internal-jobs.controller';

@Module({
  imports: [
    TurfBookingModule,
    EventBookingModule,
    InvitationModule,
    MatchmakingModule,
    StorageModule,
    EngagementModule,
  ],
  controllers: [InternalJobsController],
})
export class InternalJobsModule {}
