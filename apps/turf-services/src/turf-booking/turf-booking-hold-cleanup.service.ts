import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { config } from '../core/config/env.config';
import { TurfBookingService } from './turf-booking.service';

@Injectable()
export class TurfBookingHoldCleanupService {
  private readonly logger = new Logger(TurfBookingHoldCleanupService.name);

  constructor(private readonly turfBookingService: TurfBookingService) {}

  @Cron(config.PAYMENT_HOLD_RELEASE_CRON)
  async releaseExpiredHolds(): Promise<void> {
    try {
      await this.turfBookingService.releaseExpiredSlotHolds();
    } catch (error) {
      this.logger.error(
        `Turf booking hold release failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
