import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UnusedUploadRegistry,
  UnusedUploadRegistrySchema,
} from '../storage/schemas/unused-upload-registry.schema';
import {
  DailyUsageQuota,
  DailyUsageQuotaSchema,
} from './schemas/daily-usage-quota.schema';
import { UsageQuotaService } from './usage-quota.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyUsageQuota.name, schema: DailyUsageQuotaSchema },
      { name: UnusedUploadRegistry.name, schema: UnusedUploadRegistrySchema },
    ]),
  ],
  providers: [UsageQuotaService],
  exports: [UsageQuotaService],
})
export class UsageQuotaModule {}
