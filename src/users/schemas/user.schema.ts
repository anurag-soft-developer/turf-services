import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import type {
  FcmTokenEntry,
  IUser,
  IOAuthStrategy,
} from '../interfaces/user.interface';
import { type NotificationModule } from '../../notification/schemas/notification.schema';
import { UserRole } from '../../auth/decorators/roles.decorator';
import type { PlayerSportEntry } from '../../core/sports/sport-stats';
import type { EarnedBadge } from '../../core/badges/badges';

export type UserDocument = Omit<
  IUser,
  '_id' | 'lastLogin' | 'createdAt' | 'updatedAt'
> &
  Document & {
    lastLogin?: Date;
    createdAt: Date;
    updatedAt: Date;
  };

export enum OAuthProvider {
  GOOGLE = 'google',
  FACEBOOK = 'facebook',
  GITHUB = 'github',
  TWITTER = 'twitter',
  LINKEDIN = 'linkedin',
}

export enum OtpKeys {
  VERIFY_EMAIL = 'verify_email',
  FORGOT_PASSWORD = 'forgot_password',
  LOGIN_2FA = 'login_2fa',
  CHANGE_PASSWORD = 'change_password',
  UPDATE_2FA = 'update_2fa',
}

export const userSelectFields: string = '_id fullName avatar email';

@Schema({
  timestamps: true,
  toJSON: {
    transform: function (doc, ret) {
      //   ret.id = ret._id;
      //   delete ret.__v;
      //   if (ret.password) delete ret.password;
      //   if (ret.otp) delete ret.otp;
      return ret;
    },
  },
})
export class User extends Document implements UserDocument {
  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email!: string;

  @Prop({
    type: String,
    // select: false,
  })
  password?: string;

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.USER,
  })
  role!: string;

  @Prop({
    type: [
      {
        provider: {
          type: String,
          enum: Object.values(OAuthProvider),
        },
        id: String,
        accessToken: String,
        refreshToken: String,
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    default: [],
  })
  oAuthStrategies?: IOAuthStrategy[];

  @Prop({
    type: String,
    trim: true,
  })
  fullName?: string;

  @Prop({
    type: String,
  })
  avatar?: string;

  @Prop({
    type: Boolean,
    default: true,
  })
  isActive?: boolean;

  @Prop({
    type: Boolean,
    default: false,
  })
  isVerified?: boolean;

  @Prop({
    type: Boolean,
    default: false,
  })
  isEmailVerified?: boolean;

  @Prop({
    type: Boolean,
    default: false,
  })
  twoFactorEnabled?: boolean;

  @Prop({
    type: Boolean,
    default: true,
  })
  emailNotificationsEnabled?: boolean;

  @Prop({
    type: Boolean,
    default: false,
  })
  smsNotificationsEnabled?: boolean;

  /**
   * Master switch for push (FCM) and coordinated in-app delivery.
   * Checked before any device-level notification is sent.
   */
  @Prop({
    type: Boolean,
    default: true,
  })
  notificationsEnabled?: boolean;

  /**
   * Per–notification-module toggles. Missing key = enabled (opt-out per module).
   * Keys must be {@link NotificationModule} string values.
   */
  @Prop({
    type: Object,
    default: {},
  })
  notificationModules?: Partial<Record<NotificationModule, boolean>>;

  /**
   * Registered FCM devices. Tokens are not exposed on public profile responses.
   */
  @Prop({
    type: [
      {
        deviceKey: { type: String, required: true },
        token: { type: String, required: true },
        platform: { type: String },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    _id: false,
    default: [],
    select: false,
  })
  fcmTokens!: FcmTokenEntry[];

  @Prop({
    type: String,
    select: false,
  })
  otp?: string;

  @Prop({
    type: Date,
    select: false,
  })
  otpExpiry?: Date;

  @Prop({
    type: String,
  })
  bio?: string;

  @Prop({
    type: String,
  })
  phone?: string;

  @Prop({
    type: Date,
  })
  lastLogin?: Date;

  /**
   * Career statistics per sport, accumulated across all teams.
   * One entry per sport the player has participated in.
   * `stats` is Mixed — shape is determined by `sportType`.
   */
  @Prop({
    type: [
      {
        sportType: { type: String, required: true },
        stats: { type: MongooseSchema.Types.Mixed, default: {} },
      },
    ],
    _id: false,
    default: [],
  })
  playerSportStats!: PlayerSportEntry[];

  /**
   * Badges earned by the player across all sports.
   * Each badge carries `sportType` to identify the sport it was earned in.
   */
  @Prop({
    type: [
      {
        badgeId: { type: String, required: true },
        earnedAt: { type: Date, required: true },
        sportType: { type: String },
      },
    ],
    _id: false,
    default: [],
  })
  badges!: EarnedBadge[];

  @Prop({
    type: Date,
    default: Date.now,
  })
  createdAt!: Date;

  @Prop({
    type: Date,
    default: Date.now,
  })
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Index for better query performance
// UserSchema.index({ email: 1 });
UserSchema.index({ 'oAuthStrategies.provider': 1, 'oAuthStrategies.id': 1 });
