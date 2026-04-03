import { Module } from '@nestjs/common';
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
import { LocalMatchModule } from './local-match/local-match.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ConfigModule } from '@nestjs/config';
import { config } from './core/config/env.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(config.MONGODB_URI),
    AuthModule,
    UsersModule,
    TurfModule,
    TurfBookingModule,
    TurfReviewModule,
    AppMetadataModule,
    ConnectionsModule,
    LocalMatchModule,
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
