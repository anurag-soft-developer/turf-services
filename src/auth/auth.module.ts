import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthService } from './jwt-auth.service';

import { UsersModule } from '../users/users.module';
import { config } from '../core/config/env.config';
import { EmailService } from '../core/services/email.service';
import type { StringValue } from 'ms';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy, GoogleMobileStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: config.JWT_SECRET,
      signOptions: {
        expiresIn: config.JWT_EXPIRES_IN as StringValue,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthService,
    EmailService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
    GoogleMobileStrategy,
  ],
  exports: [AuthService, JwtAuthService],
})
export class AuthModule {}
