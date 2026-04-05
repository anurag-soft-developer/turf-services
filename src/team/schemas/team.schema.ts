import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import {
  GeoLocation,
  GeoLocationSchema,
} from '../../core/schemas/geo-location.schema';

export type TeamDocument = Team & Document;

/** Stored as string; extend when adding sports. */
export enum SportType {
  CRICKET = 'cricket',
  FOOTBALL = 'football',
}

export enum TeamVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

/** Only applies when visibility is public; private teams always use approval. */
export enum TeamJoinMode {
  OPEN = 'open',
  APPROVAL = 'approval',
}

export enum TeamStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

/** Fields loaded when populating `team` on memberships (e.g. roster lists). */
export const teamPopulateSelectFields =
  '_id name logo location sportType';

@Schema({
  timestamps: true,
  collection: 'team',
})
export class Team {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({
    type: String,
    enum: Object.values(SportType),
    required: true,
  })
  sportType!: SportType;

  @Prop({ type: GeoLocationSchema, required: false })
  location?: GeoLocation;

  @Prop({
    type: String,
    enum: Object.values(TeamVisibility),
    required: true,
  })
  visibility!: TeamVisibility;

  @Prop({
    type: String,
    enum: Object.values(TeamJoinMode),
    default: TeamJoinMode.APPROVAL,
  })
  joinMode!: TeamJoinMode;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  createdBy!: Types.ObjectId;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: User.name }],
    default: [],
  })
  ownerIds!: Types.ObjectId[];

  @Prop({ type: String, trim: true, default: '' })
  logo!: string;

  @Prop({ type: [String], default: [] })
  coverImages!: string[];

  @Prop({ type: Number, required: true, min: 2, max: 500 })
  maxRosterSize!: number;

  @Prop({ type: Number, required: true, min: 0, max: 1000 })
  maxPendingJoinRequests!: number;

  @Prop({
    type: String,
    enum: Object.values(TeamStatus),
    default: TeamStatus.ACTIVE,
  })
  status!: TeamStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TeamSchema = SchemaFactory.createForClass(Team);

TeamSchema.index(
  { 'location.coordinates': '2dsphere' },
  { sparse: true },
);
TeamSchema.index({ visibility: 1, status: 1, sportType: 1 });
TeamSchema.index({ createdBy: 1 });
TeamSchema.index({ ownerIds: 1 });
