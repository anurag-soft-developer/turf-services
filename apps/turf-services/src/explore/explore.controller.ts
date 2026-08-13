import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExploreQueryDto } from './dto/explore.dto';
import { ExploreService } from './explore.service';

@Controller('explore')
@UseGuards(JwtAuthGuard)
export class ExploreController {
  constructor(private readonly exploreService: ExploreService) {}

  @Get()
  getExplore(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Query() query: ExploreQueryDto,
  ) {
    return this.exploreService.explore(userId.toString(), query);
  }
}
