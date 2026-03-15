import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Profile as GoogleProfile,
  Strategy,
  VerifyCallback,
} from 'passport-google-oauth20';
import { OAuth2Client } from 'google-auth-library';
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

@Injectable()
export class GoogleMobileStrategy {
  private oauth2Client: OAuth2Client;

  constructor(private authService: AuthService) {
    this.oauth2Client = new OAuth2Client(config.GOOGLE_CLIENT_ID);
  }

  async validateIdToken(idToken: string) {
    try {
      const ticket = await this.oauth2Client.verifyIdToken({
        idToken,
        audience: config.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new UnauthorizedException('Invalid Google ID token');
      }

      // Create a GoogleProfile-like object from the token payload
      const profile: GoogleProfile = {
        id: payload.sub,
        emails: [{ value: payload.email!, verified: payload.email_verified || false }],
        name: {
          givenName: payload.given_name || '',
          familyName: payload.family_name || '',
        },
        photos: payload.picture ? [{ value: payload.picture }] : [],
        provider: 'google',
        displayName: payload.name || '',
        profileUrl: `https://plus.google.com/${payload.sub}`,
        _raw: JSON.stringify(payload),
        _json: payload,
      };

      const result = await this.authService.googleLogin(profile);
      return result;
    } catch (error) {
      throw new UnauthorizedException('Invalid Google ID token');
    }
  }
}
