import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { config } from '../core/config/env.config';
import { MatchmakingService } from './matchmaking.service';

@Injectable()
export class MatchmakingExpiryCleanupService {
  private readonly logger = new Logger(MatchmakingExpiryCleanupService.name);

  constructor(private readonly matchmakingService: MatchmakingService) {}

  @Cron(config.TEAM_MATCH_EXPIRY_CRON)
  async expireStaleMatches(): Promise<void> {
    try {
      await this.matchmakingService.expireStaleMatches();
    } catch (error) {
      this.logger.error(
        `Matchmaking expiry cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
