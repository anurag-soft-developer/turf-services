import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationModule } from '../notification/notification.module';
import {
  SupportQuery,
  SupportQuerySchema,
} from './schemas/support-query.schema';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupportQuery.name, schema: SupportQuerySchema },
    ]),
    NotificationModule,
  ],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
