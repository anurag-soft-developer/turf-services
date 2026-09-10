import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ChatService } from '../chat/chat.service';
import { config } from '../core/config/env.config';
import { JobsTickerService } from './jobs.ticker.service';
import { JobName } from './jobs.types';

@Injectable()
export class JobsCronService {
  constructor(
    private readonly ticker: JobsTickerService,
    private readonly chatService: ChatService,
  ) {}

  @Cron(config.PAYMENT_HOLD_RELEASE_CRON)
  async releasePaymentHolds(): Promise<void> {
    await this.ticker.runRemote(JobName.PaymentHoldRelease);
  }

  @Cron(config.TEAM_INVITE_EXPIRY_CRON)
  async expireTeamInvites(): Promise<void> {
    await this.ticker.runRemote(JobName.TeamInviteExpiry);
  }

  @Cron(config.TEAM_MATCH_EXPIRY_CRON)
  async expireTeamMatches(): Promise<void> {
    await this.ticker.runRemote(JobName.TeamMatchExpiry);
  }

  @Cron(config.UNUSED_UPLOAD_REGISTRY_PURGE_CRON)
  async purgeUnusedUploads(): Promise<void> {
    await this.ticker.runRemote(JobName.UnusedUploadPurge);
  }

  @Cron(config.ENGAGEMENT_STATS_FLUSH_CRON)
  async flushEngagementStats(): Promise<void> {
    await this.ticker.runRemote(JobName.EngagementStatsFlush);
  }

  @Cron(config.CHAT_FLUSH_CRON)
  async flushChat(): Promise<void> {
    await this.ticker.run(
      JobName.ChatFlush,
      () => this.chatService.flushPendingMessages(),
      config.CHAT_FLUSH_LOCK_TTL_SECONDS,
    );
  }
}
