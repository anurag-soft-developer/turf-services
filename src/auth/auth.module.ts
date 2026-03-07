import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthService } from './jwt-auth.service';

import { UsersModule } from '../users/users.module';
import { config } from '../config/env.config';

import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    UsersModule,
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
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
  ],
  exports: [AuthService, JwtAuthService],
})
export class AuthModule {}