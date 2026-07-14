import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { config } from '../core/config/env.config';
import { StorageLifecycleService } from './storage-lifecycle.service';

@Injectable()
export class UnusedUploadRegistryCleanupService {
  private readonly logger = new Logger(UnusedUploadRegistryCleanupService.name);

  constructor(private readonly storageLifecycle: StorageLifecycleService) {}

  @Cron(config.UNUSED_UPLOAD_REGISTRY_PURGE_CRON)
  async purgeExpiredPendingUploads(): Promise<void> {
    try {
      await this.storageLifecycle.purgeExpiredPendingUploads();
    } catch (error) {
      this.logger.error(
        `Expired pending upload purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
