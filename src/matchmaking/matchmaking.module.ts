import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TurfBooking,
  TurfBookingSchema,
} from '../turf-booking/schemas/turf-booking.schema';
import { Team, TeamSchema } from '../team/schemas/team.schema';
import { TeamModule } from '../team/team.module';
import { TeamMemberModule } from '../team-member/team-member.module';
import {
  TeamMember,
  TeamMemberSchema,
} from '../team-member/schemas/team-member.schema';
import { NotificationModule } from '../notification/notification.module';
import { StorageModule } from '../storage/storage.module';
import { AnnouncedPlayersController } from './announcedPlayers/announced-players.controller';
import { AnnouncedPlayersService } from './announcedPlayers/announced-players.service';
import { MatchmakingController } from './matchmaking.controller';
import { MatchmakingService } from './matchmaking.service';
import { TeamMatch, TeamMatchSchema } from './schemas/team-match.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeamMatch.name, schema: TeamMatchSchema },
      { name: Team.name, schema: TeamSchema },
      { name: TurfBooking.name, schema: TurfBookingSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    TeamModule,
    TeamMemberModule,
    NotificationModule,
    StorageModule,
  ],
  controllers: [MatchmakingController, AnnouncedPlayersController],
  providers: [MatchmakingService, AnnouncedPlayersService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
