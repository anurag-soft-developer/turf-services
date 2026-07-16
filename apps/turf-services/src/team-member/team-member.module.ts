import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamMember, TeamMemberSchema } from './schemas/team-member.schema';
import { TeamMemberService } from './team-member.service';
import {
  TeamMemberController,
  TeamMembershipSelfController,
} from './team-member.controller';
import { TeamModule } from '../team/team.module';
import { FollowingsModule } from '../followings/followings.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    forwardRef(() => TeamModule),
    FollowingsModule,
    NotificationModule,
  ],
  controllers: [TeamMemberController, TeamMembershipSelfController],
  providers: [TeamMemberService],
  exports: [TeamMemberService],
})
export class TeamMemberModule {}
