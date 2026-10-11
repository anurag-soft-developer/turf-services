import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TurfBooking,
  TurfBookingSchema,
} from '../turf-booking/schemas/turf-booking.schema';
import { Turf, TurfSchema } from '../turf/schemas/turf.schema';
import { Team, TeamSchema } from '../team/schemas/team.schema';
import { TeamModule } from '../team/team.module';
import { TeamMemberModule } from '../team-member/team-member.module';
import {
  TeamMember,
  TeamMemberSchema,
} from '../team-member/schemas/team-member.schema';
import { NotificationModule } from '../notification/notification.module';
import { UsersModule } from '../users/users.module';
import { StorageModule } from '../storage/storage.module';
import { ScoringModule } from '../scoring/scoring.module';
import { AnnouncedPlayersController } from './announcedPlayers/announced-players.controller';
import { AnnouncedPlayersService } from './announcedPlayers/announced-players.service';
import { GuestJoinController } from './guest-join/guest-join.controller';
import { GuestJoinService } from './guest-join/guest-join.service';
import { MatchmakingController } from './matchmaking.controller';
import { MatchmakingService } from './matchmaking.service';
import { TeamMatch, TeamMatchSchema } from './schemas/team-match.schema';
import {
  Tournament,
  TournamentSchema,
} from '../tournament/schemas/tournament.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeamMatch.name, schema: TeamMatchSchema },
      { name: Team.name, schema: TeamSchema },
      { name: TurfBooking.name, schema: TurfBookingSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Turf.name, schema: TurfSchema },
      { name: Tournament.name, schema: TournamentSchema },
    ]),
    TeamModule,
    TeamMemberModule,
    UsersModule,
    NotificationModule,
    StorageModule,
    ScoringModule,
  ],
  controllers: [
    MatchmakingController,
    AnnouncedPlayersController,
    GuestJoinController,
  ],
  providers: [MatchmakingService, AnnouncedPlayersService, GuestJoinService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
