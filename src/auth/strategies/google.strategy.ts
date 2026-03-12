import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Profile as GoogleProfile,
  Strategy,
  VerifyCallback,
} from 'passport-google-oauth20';
import { AuthService } from '../auth.service';
import { config } from '../../config/env.config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService) {
    super({
      clientID: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      callbackURL: config.GOOGLE_CALLBACK_URL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ) {
    try {
      const result = await this.authService.googleLogin(profile);
      done(null, result);
    } catch (error) {
      done(error, false);
    }
  }
}

export type { GoogleProfile };
