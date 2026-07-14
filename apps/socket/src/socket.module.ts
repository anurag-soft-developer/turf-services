import { Module } from '@nestjs/common';
import { ChatModule } from './chat/chat.module';
import { NotificationModule } from './notification/notification.module';
import { RedisModule } from './core/redis/redis.module';
import { ScoringModule } from './scoring/scoring.module';

@Module({
  imports: [RedisModule, ChatModule, NotificationModule, ScoringModule],
})
export class SocketModule {}
