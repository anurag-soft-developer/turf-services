import type { PlayerSportEntry } from '../../core/sports/sport-stats';
import type { EarnedBadge } from '../../core/badges/badges';

export interface IOAuthStrategy {
  provider: 'google' | 'facebook' | 'github' | 'twitter' | 'linkedin';
  id: string;
  accessToken?: string;
  refreshToken?: string;
  createdAt: Date;
}

export interface Profile {
  _id: string;
  email: string;
  role: string;
  fullName?: string;
  bio?: string;
  avatar?: string;
  isActive?: boolean;
  isVerified?: boolean;
  isEmailVerified?: boolean;
  twoFactorEnabled?: boolean;
  emailNotificationsEnabled?: boolean;
  smsNotificationsEnabled?: boolean;
  playerSportStats?: PlayerSportEntry[];
  badges?: EarnedBadge[];
  isPasswordExists?: boolean;
  phone?: string;
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfile extends Pick<
  Profile,
  | '_id'
  | 'fullName'
  | 'avatar'
  | 'bio'
  | 'isVerified'
  | 'playerSportStats'
  | 'badges'
> {}

export interface IUser extends Profile {
  password?: string;
  oAuthStrategies?: IOAuthStrategy[];
  otp?: string;
  otpExpiry?: Date;
}
