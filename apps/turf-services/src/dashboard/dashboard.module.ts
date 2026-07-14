import { Module } from '@nestjs/common';
import { TurfModule } from '../turf/turf.module';
import { TeamModule } from '../team/team.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TurfModule, TeamModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
