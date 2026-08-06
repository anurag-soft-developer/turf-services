import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthService } from './jwt-auth.service';

import { UsersModule } from '../users/users.module';
import { config } from '../core/config/env.config';
import { EmailService } from '../core/services/email.service';
import { SmsService } from '../core/services/sms.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import {
  GoogleStrategy,
  GoogleMobileStrategy,
} from './strategies/google.strategy';
import { TeamInviteModule } from '../team-invite/team-invite.module';

@Module({
  imports: [
    UsersModule,
    TeamInviteModule,
    PassportModule,
    JwtModule.register({
      secret: config.JWT_SECRET,
      signOptions: {
        expiresIn: config.JWT_EXPIRES_IN,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthService,
    EmailService,
    SmsService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
    GoogleMobileStrategy,
  ],
  exports: [AuthService, JwtAuthService],
})
export class AuthModule {}
