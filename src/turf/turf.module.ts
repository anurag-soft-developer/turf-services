import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurfService } from './turf.service';
import { TurfApprovalService } from './turf-approval.service';
import { TurfController } from './turf.controller';
import { Turf, TurfSchema } from './schemas/turf.schema';
import { UsersModule } from '../users/users.module';
import { NotificationModule } from '../notification/notification.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Turf.name, schema: TurfSchema }]),
    UsersModule,
    NotificationModule,
    StorageModule,
  ],
  controllers: [TurfController],
  providers: [TurfService, TurfApprovalService],
  exports: [TurfService, TurfApprovalService],
})
export class TurfModule {}
