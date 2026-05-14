import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  AppendCricketBallDto,
  CreateCricketSessionDto,
  UpdateCricketStateDto,
} from './dto/cricket-scoring.dto';
import { CricketScoringService } from './cricket-scoring.service';

@Controller('scoring/cricket')
@UseGuards(JwtAuthGuard)
export class CricketScoringController {
  constructor(private readonly cricketScoringService: CricketScoringService) {}

  @Post('matches/:teamMatchId/session')
  async createSession(
    @Param('teamMatchId') teamMatchId: string,
    @Body() dto: CreateCricketSessionDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.cricketScoringService.createSession(
      userId.toString(),
      teamMatchId,
      dto,
    );
  }

  @Post('matches/:teamMatchId/balls')
  async appendBall(
    @Param('teamMatchId') teamMatchId: string,
    @Body() dto: AppendCricketBallDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.cricketScoringService.appendBall(
      userId.toString(),
      teamMatchId,
      dto,
    );
  }

  @Post('matches/:teamMatchId/inning/change')
  async changeInning(
    @Param('teamMatchId') teamMatchId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.cricketScoringService.changeInning(
      userId.toString(),
      teamMatchId,
    );
  }

  @Delete('matches/:teamMatchId/balls/last')
  async undoLastBall(
    @Param('teamMatchId') teamMatchId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.cricketScoringService.undoLastBall(
      userId.toString(),
      teamMatchId,
    );
  }

  @Get('matches/:teamMatchId')
  async getSession(@Param('teamMatchId') teamMatchId: string) {
    return this.cricketScoringService.getSessionView(teamMatchId);
  }

  @Patch('matches/:teamMatchId/state')
  async updateState(
    @Param('teamMatchId') teamMatchId: string,
    @Body() dto: UpdateCricketStateDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.cricketScoringService.updateCricketState(
      userId.toString(),
      teamMatchId,
      dto,
    );
  }

  @Get('matches/:teamMatchId/overs')
  async listOvers(@Param('teamMatchId') teamMatchId: string) {
    return this.cricketScoringService.listOvers(teamMatchId);
  }

  @Get('matches/:teamMatchId/points')
  async getPoints(@Param('teamMatchId') teamMatchId: string) {
    return this.cricketScoringService.getPoints(teamMatchId);
  }
}
