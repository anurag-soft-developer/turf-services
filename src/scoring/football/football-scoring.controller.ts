import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  AppendFootballEventDto,
  CreateFootballSessionDto,
  ListFootballEventsDto,
} from './dto/football-scoring.dto';
import { FootballScoringService } from './football-scoring.service';

@Controller('scoring/football')
@UseGuards(JwtAuthGuard)
export class FootballScoringController {
  constructor(
    private readonly footballScoringService: FootballScoringService,
  ) {}

  @Post('matches/:teamMatchId/session')
  async createSession(
    @Param('teamMatchId') teamMatchId: string,
    @Body() dto: CreateFootballSessionDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.footballScoringService.createSession(
      userId.toString(),
      teamMatchId,
      dto,
    );
  }

  @Post('matches/:teamMatchId/events')
  async appendEvent(
    @Param('teamMatchId') teamMatchId: string,
    @Body() dto: AppendFootballEventDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.footballScoringService.appendEvent(
      userId.toString(),
      teamMatchId,
      dto,
    );
  }

  @Get('matches/:teamMatchId')
  async getSession(@Param('teamMatchId') teamMatchId: string) {
    return this.footballScoringService.getSessionView(teamMatchId);
  }

  @Get('matches/:teamMatchId/events')
  async listEvents(
    @Param('teamMatchId') teamMatchId: string,
    @Query() query: ListFootballEventsDto,
  ) {
    return this.footballScoringService.listEvents(teamMatchId, query);
  }

  @Get('matches/:teamMatchId/points')
  async getPoints(@Param('teamMatchId') teamMatchId: string) {
    return this.footballScoringService.getPoints(teamMatchId);
  }
}
