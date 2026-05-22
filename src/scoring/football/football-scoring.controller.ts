import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  AppendFootballEventDto,
  ChangeFootballInningDto,
  CreateFootballSessionDto,
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

  @Post('matches/:teamMatchId/inning/change')
  async changeInning(
    @Param('teamMatchId') teamMatchId: string,
    @Body() dto: ChangeFootballInningDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.footballScoringService.changeInning(
      userId.toString(),
      teamMatchId,
      dto,
    );
  }

  @Post('matches/:teamMatchId/timer/pause')
  async pauseTimer(
    @Param('teamMatchId') teamMatchId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.footballScoringService.pauseTimer(
      userId.toString(),
      teamMatchId,
    );
  }

  @Post('matches/:teamMatchId/timer/resume')
  async resumeTimer(
    @Param('teamMatchId') teamMatchId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.footballScoringService.resumeTimer(
      userId.toString(),
      teamMatchId,
    );
  }

  @Post('matches/:teamMatchId/complete')
  async completeMatch(
    @Param('teamMatchId') teamMatchId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.footballScoringService.completeMatch(
      userId.toString(),
      teamMatchId,
    );
  }

  @Get('matches/:teamMatchId')
  async getSession(@Param('teamMatchId') teamMatchId: string) {
    return this.footballScoringService.getSessionView(teamMatchId);
  }

  @Delete('matches/:teamMatchId/events/last')
  async undoLastEvent(
    @Param('teamMatchId') teamMatchId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.footballScoringService.undoLastEvent(
      userId.toString(),
      teamMatchId,
    );
  }

  @Get('matches/:teamMatchId/events')
  async listEvents(@Param('teamMatchId') teamMatchId: string) {
    return this.footballScoringService.listEvents(teamMatchId);
  }

  @Get('matches/:teamMatchId/points')
  async getPoints(@Param('teamMatchId') teamMatchId: string) {
    return this.footballScoringService.getPoints(teamMatchId);
  }
}
