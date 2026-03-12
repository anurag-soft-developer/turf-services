import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { IUser, IOAuthStrategy } from '../interfaces/user.interface';
import { UserRole } from '../../auth/decorators/roles.decorator';

export type UserDocument = Omit<
  IUser,
  '_id' | 'lastLogin' | 'createdAt' | 'updatedAt'
> &
  Document & {
    createdAt: Date;
    updatedAt: Date;
    lastLogin?: Date;
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
}

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
    select: false,
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
