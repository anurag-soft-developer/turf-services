import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { config } from '../core/config/env.config';
import { EngagementService } from './engagement.service';

@Injectable()
export class EngagementFlushService {
  private readonly logger = new Logger(EngagementFlushService.name);

  constructor(private readonly engagementService: EngagementService) {}

  @Cron(config.ENGAGEMENT_STATS_FLUSH_CRON)
  async flushStats(): Promise<void> {
    try {
      const flushed = await this.engagementService.flushRedisStatsToMongo();
      if (flushed > 0) {
        this.logger.log(`Flushed ${flushed} engagement stat keys`);
      }
    } catch (error) {
      this.logger.error(
        `Engagement stats flush failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
