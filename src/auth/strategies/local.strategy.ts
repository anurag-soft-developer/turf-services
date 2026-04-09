import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      usernameField: 'email',
      passwordField: 'password',
    });
  }

  async validate(email: string, password: string) {
    try {
      const result = await this.authService.login({ email, password });
      if (!('user' in result)) {
        throw new UnauthorizedException('OTP verification required');
      }
      return result.user;
    } catch (error) {
      throw new UnauthorizedException('Invalid credentials');
    }
  }
}
