import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ChatModule } from './chat/chat.module';
import { NotificationModule } from './notification/notification.module';
import { RedisModule } from './core/redis/redis.module';
import { ScoringModule } from './scoring/scoring.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    RedisModule,
    ChatModule,
    NotificationModule,
    ScoringModule,
    JobsModule,
  ],
})
export class SocketModule {}
