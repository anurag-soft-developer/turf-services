import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurfReviewService } from './turf-review.service';
import { TurfReviewController } from './turf-review.controller';
import {
  TurfReview,
  TurfReviewSchema,
} from './schemas/turf-review.schema';
import { Turf, TurfSchema } from '../turf/schemas/turf.schema';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TurfReview.name, schema: TurfReviewSchema },
      { name: Turf.name, schema: TurfSchema },
    ]),
    StorageModule,
  ],
  controllers: [TurfReviewController],
  providers: [TurfReviewService],
  exports: [TurfReviewService],
})
export class TurfReviewModule {}