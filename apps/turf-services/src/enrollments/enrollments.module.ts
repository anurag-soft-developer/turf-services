import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvitationModule } from '../invitations/invitation.module';
import {
  Invitation,
  InvitationSchema,
} from '../invitations/schemas/invitation.schema';
import { NotificationModule } from '../notification/notification.module';
import { OpeningsModule } from '../openings/openings.module';
import { Opening, OpeningSchema } from '../openings/schemas/opening.schema';
import { TeamMemberModule } from '../team-member/team-member.module';
import { Team, TeamSchema } from '../team/schemas/team.schema';
import { TeamModule } from '../team/team.module';
import {
  Tournament,
  TournamentSchema,
} from '../tournament/schemas/tournament.schema';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { Enrollment, EnrollmentSchema } from './schemas/enrollment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Opening.name, schema: OpeningSchema },
      { name: Team.name, schema: TeamSchema },
      { name: Tournament.name, schema: TournamentSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    OpeningsModule,
    TeamModule,
    TeamMemberModule,
    InvitationModule,
    NotificationModule,
  ],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
