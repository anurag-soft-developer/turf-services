import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationModule } from '../notification/notification.module';
import { InvitationModule } from '../invitations/invitation.module';
import {
  Invitation,
  InvitationSchema,
} from '../invitations/schemas/invitation.schema';
import {
  TeamMatch,
  TeamMatchSchema,
} from '../matchmaking/schemas/team-match.schema';
import { TeamMember, TeamMemberSchema } from '../team-member/schemas/team-member.schema';
import { Team, TeamSchema } from '../team/schemas/team.schema';
import { TeamModule } from '../team/team.module';
import { UsersModule } from '../users/users.module';
import { Tournament, TournamentSchema } from './schemas/tournament.schema';
import { TournamentController } from './tournament.controller';
import { TournamentDrawService } from './tournament-draw.service';
import { TournamentService } from './tournament.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tournament.name, schema: TournamentSchema },
      { name: Invitation.name, schema: InvitationSchema },
      { name: TeamMatch.name, schema: TeamMatchSchema },
      { name: Team.name, schema: TeamSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    InvitationModule,
    TeamModule,
    UsersModule,
    NotificationModule,
  ],
  controllers: [TournamentController],
  providers: [TournamentService, TournamentDrawService],
  exports: [TournamentService],
})
export class TournamentModule {}
