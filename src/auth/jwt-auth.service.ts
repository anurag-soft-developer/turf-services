import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { IJwtPayload } from './interfaces/auth.interface';
import type { IUser } from '../users/interfaces/user.interface';
import { UserDocument } from 'users/schemas/user.schema';
import { config } from '../config/env.config';

@Injectable()
export class JwtAuthService {
  constructor(
    private jwtService: JwtService,
  ) {}

  generateAccessToken(user: IUser | UserDocument): string {
    const payload: IJwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    return this.jwtService.sign(payload, {
      expiresIn: config.JWT_EXPIRES_IN,
    });
  }

  generateRefreshToken(user: IUser | UserDocument): string {
    const payload: IJwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    return this.jwtService.sign(payload, {
      secret: config.JWT_REFRESH_SECRET,
      expiresIn: config.JWT_REFRESH_EXPIRES_IN,
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
      return this.jwtService.decode(token) as IJwtPayload;
    } catch (error) {
      return null;
    }
  }
}