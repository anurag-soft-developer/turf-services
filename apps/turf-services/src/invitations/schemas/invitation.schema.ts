import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { Team } from '../../team/schemas/team.schema';
import { Tournament } from '../../tournament/schemas/tournament.schema';
import { User } from '../../users/schemas/user.schema';
import {
  InvitationKind,
  InvitationStatus,
  TournamentInvitationDirection,
} from '../invitation.constants';

export type InvitationDocument = Invitation & Document;

@Schema({
  timestamps: true,
  collection: 'invitations',
})
export class Invitation {
  @Prop({
    type: String,
    enum: Object.values(InvitationKind),
    required: true,
    index: true,
  })
  kind!: InvitationKind;

  @Prop({
    type: String,
    enum: Object.values(InvitationStatus),
    required: true,
    default: InvitationStatus.PENDING,
    index: true,
  })
  status!: InvitationStatus;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  invitedBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  decidedBy?: Types.ObjectId;

  @Prop({ type: Date })
  decidedAt?: Date;

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
    required: false,
    index: true,
  })
  inviteeUser?: Types.ObjectId;

  @Prop({ type: String, trim: true, lowercase: true })
  email?: string;

  /** E.164 */
  @Prop({ type: String, trim: true })
  phone?: string;

  @Prop({ type: String })
  token?: string;

  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Tournament.name,
    index: true,
  })
  tournament?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(TournamentInvitationDirection),
  })
  direction?: TournamentInvitationDirection;

  @Prop({ type: Date })
  acceptedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);

InvitationSchema.index(
  { token: 1 },
  { unique: true, sparse: true },
);

InvitationSchema.index(
  { team: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: InvitationKind.TEAM_INVITE,
      status: InvitationStatus.PENDING,
      email: { $type: 'string' },
    },
  },
);

InvitationSchema.index(
  { team: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: InvitationKind.TEAM_INVITE,
      status: InvitationStatus.PENDING,
      phone: { $type: 'string' },
    },
  },
);

InvitationSchema.index(
  { team: 1, inviteeUser: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: InvitationKind.TEAM_INVITE,
      status: InvitationStatus.PENDING,
      inviteeUser: { $exists: true },
    },
  },
);

InvitationSchema.index({ kind: 1, team: 1, inviteeUser: 1, status: 1 });
InvitationSchema.index({ kind: 1, inviteeUser: 1, status: 1, createdAt: -1 });
InvitationSchema.index({ kind: 1, team: 1, status: 1, createdAt: -1 });

InvitationSchema.index(
  { tournament: 1, team: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: InvitationKind.TOURNAMENT_INVITE,
      status: { $in: [InvitationStatus.PENDING, InvitationStatus.ACCEPTED] },
    },
  },
);

InvitationSchema.index({
  kind: 1,
  tournament: 1,
  status: 1,
  createdAt: 1,
});
