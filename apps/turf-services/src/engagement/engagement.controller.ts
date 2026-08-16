import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EngagementService } from './engagement.service';
import { EngagementBatchDto, LikeBodyDto } from './dto/engagement.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class EngagementController {
  constructor(private readonly engagementService: EngagementService) {}

  @Post('engagement/batch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ingestBatch(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() dto: EngagementBatchDto,
  ): Promise<void> {
    await this.engagementService.ingestBatch(userId.toString(), dto);
  }

  @Post('likes')
  @HttpCode(HttpStatus.CREATED)
  async like(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() dto: LikeBodyDto,
  ) {
    return this.engagementService.like(userId.toString(), dto);
  }

  @Delete('likes')
  async unlike(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() dto: LikeBodyDto,
  ) {
    return this.engagementService.unlike(userId.toString(), dto);
  }
}
