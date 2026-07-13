import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import type { Request } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, _username: string, password: string) {
    try {
      const result = await this.authService.login({
        email: req.body?.email,
        phone: req.body?.phone,
        password,
      });
      if (!('user' in result)) {
        throw new UnauthorizedException('OTP verification required');
      }
      return result.user;
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }
  }
}
