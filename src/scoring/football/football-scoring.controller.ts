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

  @Post('sessions')
  async createSession(
    @Body() dto: CreateFootballSessionDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.footballScoringService.createSession(userId.toString(), dto);
  }

  @Post('sessions/:sessionId/events')
  async appendEvent(
    @Param('sessionId') sessionId: string,
    @Body() dto: AppendFootballEventDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.footballScoringService.appendEvent(
      userId.toString(),
      sessionId,
      dto,
    );
  }

  @Get('sessions/:sessionId')
  async getSession(@Param('sessionId') sessionId: string) {
    return this.footballScoringService.getSessionView(sessionId);
  }

  @Get('sessions/:sessionId/events')
  async listEvents(
    @Param('sessionId') sessionId: string,
    @Query() query: ListFootballEventsDto,
  ) {
    return this.footballScoringService.listEvents(sessionId, query);
  }

  @Get('sessions/:sessionId/points')
  async getPoints(@Param('sessionId') sessionId: string) {
    return this.footballScoringService.getPoints(sessionId);
  }
}
