import { Profile } from '../../users/interfaces/user.interface';
import { UserRole } from '../decorators/roles.decorator';

export interface IJwtPayload {
  sub: string;
  email?: string;
  phone?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface IAuthResponse {
  user: Profile;
  accessToken: string;
  refreshToken: string;
}

export interface IAuthOtpChallengeResponse {
  message: string;
  requiresOtp: true;
  channel: 'email' | 'sms';
  email?: string;
  phone?: string;
}
