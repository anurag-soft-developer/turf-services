import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TeamMatch,
  TeamMatchSchema,
} from '../matchmaking/schemas/team-match.schema';
import { Team, TeamSchema } from '../team/schemas/team.schema';
import { TeamModule } from '../team/team.module';
import { TeamMemberModule } from '../team-member/team-member.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ScoringRealtimeDispatcher } from './common/scoring-realtime-dispatcher.service';
import {
  CricketOverEvent,
  CricketOverEventSchema,
} from './cricket/cricket-over-event.schema';
import { CricketMatchStatsService } from './cricket/cricket-match-stats.service';
import { CricketRankingPointsService } from './cricket/cricket-ranking-points.service';
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
      { name: CricketOverEvent.name, schema: CricketOverEventSchema },
      { name: FootballMatchEvent.name, schema: FootballMatchEventSchema },
      { name: TeamMatch.name, schema: TeamMatchSchema },
      { name: Team.name, schema: TeamSchema },
      { name: User.name, schema: UserSchema },
    ]),
    TeamModule,
    TeamMemberModule,
  ],
  controllers: [CricketScoringController, FootballScoringController],
  providers: [
    ScoringRealtimeDispatcher,
    CricketMatchStatsService,
    CricketRankingPointsService,
    CricketScoringService,
    FootballScoringService,
  ],
  exports: [CricketScoringService, FootballScoringService],
})
export class ScoringModule {}
