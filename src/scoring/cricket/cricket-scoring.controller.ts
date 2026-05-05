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
  AppendCricketBallDto,
  CreateCricketSessionDto,
  ListCricketBallsDto,
} from './dto/cricket-scoring.dto';
import { CricketScoringService } from './cricket-scoring.service';

@Controller('scoring/cricket')
@UseGuards(JwtAuthGuard)
export class CricketScoringController {
  constructor(private readonly cricketScoringService: CricketScoringService) {}

  @Post('sessions')
  async createSession(
    @Body() dto: CreateCricketSessionDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.cricketScoringService.createSession(userId.toString(), dto);
  }

  @Post('sessions/:sessionId/balls')
  async appendBall(
    @Param('sessionId') sessionId: string,
    @Body() dto: AppendCricketBallDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.cricketScoringService.appendBall(
      userId.toString(),
      sessionId,
      dto,
    );
  }

  @Get('sessions/:sessionId')
  async getSession(@Param('sessionId') sessionId: string) {
    return this.cricketScoringService.getSessionView(sessionId);
  }

  @Get('sessions/:sessionId/balls')
  async listBalls(
    @Param('sessionId') sessionId: string,
    @Query() query: ListCricketBallsDto,
  ) {
    return this.cricketScoringService.listBalls(sessionId, query);
  }

  @Get('sessions/:sessionId/points')
  async getPoints(@Param('sessionId') sessionId: string) {
    return this.cricketScoringService.getPoints(sessionId);
  }
}
