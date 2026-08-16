import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContentStats, ContentStatsSchema } from './schemas/content-stats.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { EngagementService } from './engagement.service';
import { EngagementController } from './engagement.controller';
import { EngagementFlushService } from './engagement-flush.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContentStats.name, schema: ContentStatsSchema },
      { name: Like.name, schema: LikeSchema },
    ]),
  ],
  controllers: [EngagementController],
  providers: [EngagementService, EngagementFlushService],
  exports: [EngagementService],
})
export class EngagementModule {}
