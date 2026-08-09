import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { config } from '../core/config/env.config';
import { EventBookingService } from './event-booking.service';

@Injectable()
export class EventBookingHoldCleanupService {
  private readonly logger = new Logger(EventBookingHoldCleanupService.name);

  constructor(private readonly eventBookingService: EventBookingService) {}

  @Cron(config.PAYMENT_HOLD_RELEASE_CRON)
  async releaseExpiredHolds(): Promise<void> {
    try {
      await this.eventBookingService.releaseExpiredPaymentHolds();
    } catch (error) {
      this.logger.error(
        `Event booking hold release failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
