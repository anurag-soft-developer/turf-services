import { Module } from '@nestjs/common';
import { TurfModule } from '../turf/turf.module';
import { TeamModule } from '../team/team.module';
import { NotificationModule } from '../notification/notification.module';
import { TurfBookingModule } from '../turf-booking/turf-booking.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TurfModule, TeamModule, NotificationModule, TurfBookingModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
