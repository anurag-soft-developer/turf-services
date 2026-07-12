import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';
import { PlayerDashboardQueryDto } from './dto/player-dashboard.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('player')
  getPlayerDashboard(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Query() query: PlayerDashboardQueryDto,
  ) {
    return this.dashboardService.getPlayerDashboard(userId.toString(), query);
  }
}
