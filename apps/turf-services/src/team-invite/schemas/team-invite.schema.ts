import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { Team } from '../../team/schemas/team.schema';

export type TeamInviteDocument = TeamInvite & Document;

export enum TeamInviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Schema({
  timestamps: true,
  collection: 'team-invites',
})
export class TeamInvite {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    required: true,
    index: true,
  })
  team!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  invitedBy!: Types.ObjectId;

  /** Set when invitee is already registered, or after claim on signup/login. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: false,
    index: true,
  })
  inviteeUser?: Types.ObjectId;

  @Prop({ type: String, trim: true, lowercase: true })
  email?: string;

  /** E.164 */
  @Prop({ type: String, trim: true })
  phone?: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  token!: string;

  @Prop({
    type: String,
    enum: Object.values(TeamInviteStatus),
    required: true,
    default: TeamInviteStatus.PENDING,
  })
  status!: TeamInviteStatus;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date })
  respondedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TeamInviteSchema = SchemaFactory.createForClass(TeamInvite);

TeamInviteSchema.index(
  { team: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'pending',
      email: { $type: 'string' },
    },
  },
);

TeamInviteSchema.index(
  { team: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'pending',
      phone: { $type: 'string' },
    },
  },
);

TeamInviteSchema.index(
  { team: 1, inviteeUser: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'pending',
      inviteeUser: { $exists: true },
    },
  },
);

TeamInviteSchema.index({ inviteeUser: 1, status: 1, createdAt: -1 });
TeamInviteSchema.index({ team: 1, status: 1, createdAt: -1 });
