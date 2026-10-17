import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Team, TeamSchema } from '../team/schemas/team.schema';
import { TeamModule } from '../team/team.module';
import {
  Enrollment,
  EnrollmentSchema,
} from '../enrollments/schemas/enrollment.schema';
import {
  Tournament,
  TournamentSchema,
} from '../tournament/schemas/tournament.schema';
import { OpeningsController } from './openings.controller';
import { OpeningsService } from './openings.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Opening, OpeningSchema } from './schemas/opening.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Opening.name, schema: OpeningSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Team.name, schema: TeamSchema },
      { name: Tournament.name, schema: TournamentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    TeamModule,
  ],
  controllers: [OpeningsController],
  providers: [OpeningsService],
  exports: [OpeningsService],
})
export class OpeningsModule {}
