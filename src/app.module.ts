import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TurfModule } from './turf/turf.module';
import { TurfBookingModule } from './turf-booking/turf-booking.module';
import { TurfReviewModule } from './turf-review/turf-review.module';
import { AppMetadataModule } from './app-metadata/app-metadata.module';
import { ConnectionsModule } from './connections/connections.module';
import { TeamModule } from './team/team.module';
import { PostModule } from './post/post.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ConfigModule } from '@nestjs/config';
import { config } from './core/config/env.config';
import { MatchmakingModule } from './matchmaking/matchmaking.module';
import { ChatModule } from './chat/chat.module';
import { NotificationModule } from './notification/notification.module';
import { StorageModule } from './storage/storage.module';
import { WebhookModule } from './webhook/webhook.module';
import { ScoringModule } from './scoring/scoring.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { WalletModule } from './wallet/wallet.module';
import { EventsModule } from './events/events.module';
import { EventBookingModule } from './event-booking/event-booking.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    MongooseModule.forRoot(config.MONGODB_URI),
    AuthModule,
    UsersModule,
    TurfModule,
    TurfBookingModule,
    EventsModule,
    EventBookingModule,
    WebhookModule,
    TurfReviewModule,
    AppMetadataModule,
    ConnectionsModule,
    TeamModule,
    PostModule,
    MatchmakingModule,
    ScoringModule,
    ChatModule,
    NotificationModule,
    StorageModule,
    WalletModule,
    WithdrawalsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
})
export class AppModule {}
