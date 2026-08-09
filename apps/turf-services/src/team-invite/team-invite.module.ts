import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamInvite, TeamInviteSchema } from './schemas/team-invite.schema';
import { TeamInviteService } from './team-invite.service';
import { TeamInviteExpiryCleanupService } from './team-invite-expiry-cleanup.service';
import {
  TeamInviteController,
  TeamInviteSelfController,
} from './team-invite.controller';
import { TeamModule } from '../team/team.module';
import { TeamMemberModule } from '../team-member/team-member.module';
import { UsersModule } from '../users/users.module';
import { NotificationModule } from '../notification/notification.module';
import { EmailService } from '../core/services/email.service';
import { SmsService } from '../core/services/sms.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeamInvite.name, schema: TeamInviteSchema },
    ]),
    forwardRef(() => TeamModule),
    forwardRef(() => TeamMemberModule),
    UsersModule,
    NotificationModule,
  ],
  controllers: [TeamInviteController, TeamInviteSelfController],
  providers: [
    TeamInviteService,
    TeamInviteExpiryCleanupService,
    EmailService,
    SmsService,
  ],
  exports: [TeamInviteService],
})
export class TeamInviteModule {}
