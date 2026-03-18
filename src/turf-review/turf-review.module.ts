import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurfReviewService } from './turf-review.service';
import { TurfReviewController } from './turf-review.controller';
import {
  TurfReview,
  TurfReviewSchema,
} from './schemas/turf-review.schema';
import { Turf, TurfSchema } from '../turf/schemas/turf.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TurfReview.name, schema: TurfReviewSchema },
      { name: Turf.name, schema: TurfSchema },
    ]),
  ],
  controllers: [TurfReviewController],
  providers: [TurfReviewService],
  exports: [TurfReviewService],
})
export class TurfReviewModule {}