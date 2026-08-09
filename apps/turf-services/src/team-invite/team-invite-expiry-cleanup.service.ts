import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { config } from '../core/config/env.config';
import { TeamInviteService } from './team-invite.service';

@Injectable()
export class TeamInviteExpiryCleanupService {
  private readonly logger = new Logger(TeamInviteExpiryCleanupService.name);

  constructor(private readonly teamInviteService: TeamInviteService) {}

  @Cron(config.TEAM_INVITE_EXPIRY_CRON)
  async expirePendingInvites(): Promise<void> {
    try {
      await this.teamInviteService.expirePendingInvites();
    } catch (error) {
      this.logger.error(
        `Team invite expiry cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
