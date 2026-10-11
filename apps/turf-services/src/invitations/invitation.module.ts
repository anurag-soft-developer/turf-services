import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationModule } from '../notification/notification.module';
import { TeamMemberModule } from '../team-member/team-member.module';
import {
  TeamMember,
  TeamMemberSchema,
} from '../team-member/schemas/team-member.schema';
import { TeamModule } from '../team/team.module';
import { Tournament, TournamentSchema } from '../tournament/schemas/tournament.schema';
import { UsersModule } from '../users/users.module';
import { EmailService } from '../core/services/email.service';
import { SmsService } from '../core/services/sms.service';
import { InvitationSelfController } from './invitation-self.controller';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';
import { TeamInviteController } from './team-invite/team-invite.controller';
import { TeamInviteService } from './team-invite/team-invite.service';
import { TournamentInviteController } from './tournament-invite/tournament-invite.controller';
import { TournamentInviteService } from './tournament-invite/tournament-invite.service';

/** Nested `…/invitations` = parent-scoped; `GET /invitations/me` = invitee inbox. */

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invitation.name, schema: InvitationSchema },
      { name: Tournament.name, schema: TournamentSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    forwardRef(() => TeamModule),
    forwardRef(() => TeamMemberModule),
    UsersModule,
    NotificationModule,
  ],
  controllers: [
    TeamInviteController,
    TournamentInviteController,
    InvitationSelfController,
  ],
  providers: [
    TeamInviteService,
    TournamentInviteService,
    EmailService,
    SmsService,
  ],
  exports: [TeamInviteService, TournamentInviteService],
})
export class InvitationModule {}
