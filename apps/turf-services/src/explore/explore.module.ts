import { Module } from '@nestjs/common';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { TeamModule } from '../team/team.module';
import { UsersModule } from '../users/users.module';
import { ExploreController } from './explore.controller';
import { ExploreService } from './explore.service';

@Module({
  imports: [MatchmakingModule, TeamModule, UsersModule],
  controllers: [ExploreController],
  providers: [ExploreService],
})
export class ExploreModule {}
