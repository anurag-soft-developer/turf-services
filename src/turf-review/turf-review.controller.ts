import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { TurfReviewService } from './turf-review.service';
import {
  CreateTurfReviewDto,
  UpdateTurfReviewDto,
  TurfReviewFilterDto,
  VoteReviewDto,
  ReportReviewDto,
  ModerateReviewDto,
} from './dto/turf-review.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('turf-reviews')
@UseGuards(JwtAuthGuard)
export class TurfReviewController {
  constructor(private readonly turfReviewService: TurfReviewService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createReview(
    @Body() createReviewDto: CreateTurfReviewDto,
    @CurrentUser('_id') userId: string,
  ) {
    const review = await this.turfReviewService.createReview(
      createReviewDto,
      userId,
    );

    return review;
  }

  @Get()
  @Public()
  async findAll(@Query() filterDto: TurfReviewFilterDto) {
    const result = await this.turfReviewService.findAll(filterDto);

    return result;
  }

  @Get('my-reviews')
  async findUserReviews(
    @CurrentUser('_id') userId: string,
    @Query() filterDto: Partial<TurfReviewFilterDto>,
  ) {
    const result = await this.turfReviewService.findUserReviews(
      userId,
      filterDto,
    );

    return result;
  }

  @Get('turf/:turfId')
  @Public()
  async findTurfReviews(
    @Param('turfId') turfId: string,
    @Query() filterDto: Partial<TurfReviewFilterDto>,
  ) {
    const result = await this.turfReviewService.findTurfReviews(
      turfId,
      filterDto,
    );

    return result;
  }

  @Get('turf/:turfId/stats')
  @Public()
  async getTurfReviewStats(@Param('turfId') turfId: string) {
    const stats = await this.turfReviewService.getTurfReviewStats(turfId);

    return stats;
  }

  @Get(':id')
  @Public()
  async findOne(@Param('id') id: string) {
    return await this.turfReviewService.findById(id);
  }

  @Patch(':id')
  async updateReview(
    @Param('id') id: string,
    @Body() updateReviewDto: UpdateTurfReviewDto,
    @CurrentUser('_id') userId: string,
  ) {
    const review = await this.turfReviewService.updateReview(
      id,
      updateReviewDto,
      userId,
    );

    return review
  }

  @Post(':id/vote')
  @HttpCode(HttpStatus.OK)
  async voteReview(
    @Param('id') id: string,
    @Body() voteDto: VoteReviewDto,
    @CurrentUser('_id') userId: string,
  ) {
    const review = await this.turfReviewService.voteReview(id, voteDto, userId);

    return review
  }

  @Post(':id/report')
  @HttpCode(HttpStatus.OK)
  async reportReview(
    @Param('id') id: string,
    @Body() reportDto: ReportReviewDto,
    @CurrentUser('_id') userId: string,
  ) {
    const review = await this.turfReviewService.reportReview(
      id,
      reportDto,
      userId,
    );

    return review;
  }

  @Post(':id/moderate')
  @HttpCode(HttpStatus.OK)
  async moderateReview(
    @Param('id') id: string,
    @Body() moderateDto: ModerateReviewDto,
    @CurrentUser('_id') moderatorId: string,
  ) {
    const review = await this.turfReviewService.moderateReview(
      id,
      moderateDto,
      moderatorId,
    );

    return review;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReview(
    @Param('id') id: string,
    @CurrentUser('_id') userId: string,
  ) {
    await this.turfReviewService.deleteReview(id, userId);

    return {
      success: true,
      message: 'Review deleted successfully',
    };
  }
}
