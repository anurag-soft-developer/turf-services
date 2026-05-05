import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TeamMatch,
  TeamMatchSchema,
} from '../matchmaking/schemas/team-match.schema';
import { TeamModule } from '../team/team.module';
import { TeamMemberModule } from '../team-member/team-member.module';
import {
  ScoringSession,
  ScoringSessionSchema,
} from './common/scoring-session.schema';
import { ScoringSessionService } from './common/scoring-session.service';
import {
  CricketBallEvent,
  CricketBallEventSchema,
} from './cricket/cricket-ball-event.schema';
import { CricketScoringService } from './cricket/cricket-scoring.service';
import { CricketScoringController } from './cricket/cricket-scoring.controller';
import {
  FootballMatchEvent,
  FootballMatchEventSchema,
} from './football/football-match-event.schema';
import { FootballScoringService } from './football/football-scoring.service';
import { FootballScoringController } from './football/football-scoring.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ScoringSession.name, schema: ScoringSessionSchema },
      { name: CricketBallEvent.name, schema: CricketBallEventSchema },
      { name: FootballMatchEvent.name, schema: FootballMatchEventSchema },
      { name: TeamMatch.name, schema: TeamMatchSchema },
    ]),
    TeamModule,
    TeamMemberModule,
  ],
  controllers: [CricketScoringController, FootballScoringController],
  providers: [
    ScoringSessionService,
    CricketScoringService,
    FootballScoringService,
  ],
  exports: [
    ScoringSessionService,
    CricketScoringService,
    FootballScoringService,
  ],
})
export class ScoringModule {}
