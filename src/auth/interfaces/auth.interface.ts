import { Profile } from '../../users/interfaces/user.interface';

export interface IJwtPayload {
  sub: string;
  email: string;
  isEmailVerified: boolean;
  role: string;
  iat?: number;
  exp?: number;
}

export interface IAuthResponse {
  user: Profile;
  accessToken: string;
  refreshToken: string;
}
