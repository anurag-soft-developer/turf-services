import type { PlayerSportEntry } from '../../core/sports/sport-stats';
import type { SportRankingPointsEntry } from '../../core/points/ranking-points.types';
import type { EarnedBadge } from '../../core/badges/badges';
import { UserRole } from '../../auth/decorators/roles.decorator';

export interface IOAuthStrategy {
  provider: 'google' | 'facebook' | 'github' | 'twitter' | 'linkedin';
  id: string;
  accessToken?: string;
  refreshToken?: string;
  createdAt: Date;
}


/** Stored FCM registration per physical device (also used by Mongoose user schema). */
export interface FcmTokenEntry {
  deviceKey: string;
  token: string;
  platform?: string;
  updatedAt?: Date;
}

export interface Profile {
  _id: string;
  email: string;
  role: UserRole;
  fullName?: string;
  bio?: string;
  avatar?: string;
  isActive?: boolean;
  isVerified?: boolean;
  isEmailVerified?: boolean;
  twoFactorEnabled?: boolean;
  emailNotificationsEnabled?: boolean;
  smsNotificationsEnabled?: boolean;
  notificationsEnabled?: boolean;
  notificationModules?: Record<string, boolean>;
  fcmTokens?: FcmTokenEntry[];
  playerSportStats?: PlayerSportEntry[];
  sportRankingPoints?: SportRankingPointsEntry[];
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
  | 'sportRankingPoints'
  | 'badges'
> {}

export interface IUser extends Profile {
  password?: string;
  oAuthStrategies?: IOAuthStrategy[];
  otp?: string;
  otpExpiry?: Date;
  fcmTokens?: FcmTokenEntry[];
}
