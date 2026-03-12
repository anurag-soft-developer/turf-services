import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { IJwtPayload } from './interfaces/auth.interface';
import type { IUser } from '../users/interfaces/user.interface';
import { UserDocument } from '../users/schemas/user.schema';
import { config } from '../config/env.config';
import type { StringValue } from 'ms';

@Injectable()
export class JwtAuthService {
  constructor(private jwtService: JwtService) {}

  private getPayload(user: IUser | UserDocument): IJwtPayload {
    return {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified || false,
    };
  }

  generateAccessToken(user: IUser | UserDocument): string {
    const payload = this.getPayload(user);

    return this.jwtService.sign(payload, {
      expiresIn: config.JWT_EXPIRES_IN as StringValue,
    });
  }

  generateRefreshToken(user: IUser | UserDocument): string {
    const payload = this.getPayload(user);

    return this.jwtService.sign(payload, {
      secret: config.JWT_REFRESH_SECRET,
      expiresIn: config.JWT_REFRESH_EXPIRES_IN as StringValue,
    });
  }

  async verifyAccessToken(token: string): Promise<IJwtPayload> {
    return this.jwtService.verify(token);
  }

  async verifyRefreshToken(token: string): Promise<IJwtPayload> {
    return this.jwtService.verify(token, {
      secret: config.JWT_REFRESH_SECRET,
    });
  }

  decodeToken(token: string): IJwtPayload | null {
    try {
      return this.jwtService.decode(token);
    } catch (error) {
      return null;
    }
  }
}
