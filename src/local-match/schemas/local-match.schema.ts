import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { Turf } from '../../turf/schemas/turf.schema';

export type LocalMatchDocument = LocalMatch & Document;

export type GeoPoint = { type: 'Point'; coordinates: [number, number] };

export enum LocalMatchVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

/** Only applies when visibility is public; private matches always use approval. */
export enum LocalMatchJoinMode {
  OPEN = 'open',
  APPROVAL = 'approval',
}

export enum LocalMatchStatus {
  OPEN = 'open',
  FULL = 'full',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

export enum JoinRequestStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

export const GeoPointSchema = new MongooseSchema(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  },
  { _id: false },
);

@Schema({ _id: false })
export class LocalMatchLocation {
  @Prop({ required: true, trim: true })
  address!: string;

  @Prop({ type: GeoPointSchema, required: true })
  coordinates!: GeoPoint;
}

export const LocalMatchLocationSchema =
  SchemaFactory.createForClass(LocalMatchLocation);

@Schema({ _id: true })
export class JoinRequestEntry {
  _id?: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  user!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(JoinRequestStatus),
    default: JoinRequestStatus.PENDING,
  })
  status!: JoinRequestStatus;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;
}

export const JoinRequestEntrySchema =
  SchemaFactory.createForClass(JoinRequestEntry);

@Schema({ _id: false })
export class LocalMatchMember {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  user!: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  joinedAt!: Date;
}

export const LocalMatchMemberSchema =
  SchemaFactory.createForClass(LocalMatchMember);

@Schema({
  timestamps: true,
  collection: 'local-matches',
})
export class LocalMatch {
  @Prop({ type: String, required: true, trim: true })
  title!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ type: [String], default: [] })
  sportTypes!: string[];

  @Prop({
    type: String,
    enum: Object.values(LocalMatchVisibility),
    required: true,
  })
  visibility!: LocalMatchVisibility;

  @Prop({
    type: String,
    enum: Object.values(LocalMatchJoinMode),
    default: LocalMatchJoinMode.APPROVAL,
  })
  joinMode!: LocalMatchJoinMode;

  @Prop({ type: LocalMatchLocationSchema, required: true })
  location!: LocalMatchLocation;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Turf.name,
    required: false,
  })
  turf?: Types.ObjectId;

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
  hostIds!: Types.ObjectId[];

  @Prop({ type: [LocalMatchMemberSchema], default: [] })
  members!: LocalMatchMember[];

  @Prop({ type: [JoinRequestEntrySchema], default: [] })
  joinRequests!: JoinRequestEntry[];

  @Prop({ type: Number, required: true, min: 2 })
  maxMembers!: number;

  @Prop({ type: Number, required: true, min: 0 })
  maxPendingJoinRequests!: number;

  @Prop({ type: Date, required: true })
  closingTime!: Date;

  @Prop({ type: Date })
  eventStartsAt?: Date;

  @Prop({ type: Date })
  eventEndsAt?: Date;

  @Prop({
    type: String,
    enum: Object.values(LocalMatchStatus),
    default: LocalMatchStatus.OPEN,
  })
  status!: LocalMatchStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export const LocalMatchSchema = SchemaFactory.createForClass(LocalMatch);

LocalMatchSchema.index({ 'location.coordinates': '2dsphere' });
LocalMatchSchema.index({ visibility: 1, status: 1, closingTime: 1 });
LocalMatchSchema.index({ createdBy: 1 });
LocalMatchSchema.index({ hostIds: 1 });
