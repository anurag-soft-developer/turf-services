import {
  Controller,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { config } from '../core/config/env.config';
import { EngagementService } from '../engagement/engagement.service';
import { EventBookingService } from '../event-booking/event-booking.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { StorageLifecycleService } from '../storage/storage-lifecycle.service';
import { TeamInviteService } from '../team-invite/team-invite.service';
import { TurfBookingService } from '../turf-booking/turf-booking.service';

@Public()
@Controller('internal/jobs')
export class InternalJobsController {
  constructor(
    private readonly turfBookingService: TurfBookingService,
    private readonly eventBookingService: EventBookingService,
    private readonly teamInviteService: TeamInviteService,
    private readonly matchmakingService: MatchmakingService,
    private readonly storageLifecycle: StorageLifecycleService,
    private readonly engagementService: EngagementService,
  ) {}

  @Post('payment-hold-release')
  @HttpCode(200)
  async releasePaymentHolds(
    @Headers('x-internal-token') internalToken: string | undefined,
  ) {
    this.assertInternalToken(internalToken);
    const errors: string[] = [];
    try {
      await this.turfBookingService.releaseExpiredSlotHolds();
    } catch (error) {
      errors.push(this.toErrorMessage('turf', error));
    }
    try {
      await this.eventBookingService.releaseExpiredPaymentHolds();
    } catch (error) {
      errors.push(this.toErrorMessage('event', error));
    }
    if (errors.length) {
      throw new InternalServerErrorException(errors.join('; '));
    }
    return { ok: true };
  }

  @Post('team-invite-expiry')
  @HttpCode(200)
  async expireTeamInvites(
    @Headers('x-internal-token') internalToken: string | undefined,
  ) {
    this.assertInternalToken(internalToken);
    const expired = await this.teamInviteService.expirePendingInvites();
    return { ok: true, expired };
  }

  @Post('team-match-expiry')
  @HttpCode(200)
  async expireTeamMatches(
    @Headers('x-internal-token') internalToken: string | undefined,
  ) {
    this.assertInternalToken(internalToken);
    const expired = await this.matchmakingService.expireStaleMatches();
    return { ok: true, expired };
  }

  @Post('unused-upload-purge')
  @HttpCode(200)
  async purgeExpiredUploads(
    @Headers('x-internal-token') internalToken: string | undefined,
  ) {
    this.assertInternalToken(internalToken);
    const purged = await this.storageLifecycle.purgeExpiredPendingUploads();
    return { ok: true, purged };
  }

  @Post('engagement-stats-flush')
  @HttpCode(200)
  async flushEngagementStats(
    @Headers('x-internal-token') internalToken: string | undefined,
  ) {
    this.assertInternalToken(internalToken);
    const flushed = await this.engagementService.flushRedisStatsToMongo();
    return { ok: true, flushed };
  }

  private assertInternalToken(internalToken: string | undefined): void {
    const expectedToken = config.INTERNAL_TOKEN;
    if (!expectedToken || internalToken !== expectedToken) {
      throw new UnauthorizedException('Invalid internal token');
    }
  }

  private toErrorMessage(label: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `${label}: ${message}`;
  }
}
