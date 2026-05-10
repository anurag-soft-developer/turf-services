import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TeamMatch,
  TeamMatchSchema,
} from '../matchmaking/schemas/team-match.schema';
import { TeamModule } from '../team/team.module';
import { TeamMemberModule } from '../team-member/team-member.module';
import { ScoringRealtimeDispatcher } from './common/scoring-realtime-dispatcher.service';
import {
  CricketOverEvent,
  CricketOverEventSchema,
} from './cricket/cricket-over-event.schema';
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
    ]),
    TeamModule,
    TeamMemberModule,
  ],
  controllers: [CricketScoringController, FootballScoringController],
  providers: [
    ScoringRealtimeDispatcher,
    CricketScoringService,
    FootballScoringService,
  ],
  exports: [CricketScoringService, FootballScoringService],
})
export class ScoringModule {}
