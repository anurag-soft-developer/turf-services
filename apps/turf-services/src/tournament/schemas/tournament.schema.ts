import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { SportType } from '../../core/sports/sport-types';
import { Team } from '../../team/schemas/team.schema';
import { User } from '../../users/schemas/user.schema';
import {
  HYBRID_ADVANCE_COUNT,
  HYBRID_GROUP_SIZE,
  TournamentFormat,
  TournamentStatus,
} from '../tournament.constants';
export type TournamentDocument = Tournament & Document;

@Schema({ _id: false })
export class TournamentManualQualifier {
  @Prop({ type: String, required: true, trim: true })
  groupLabel!: string;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: Team.name }],
    required: true,
  })
  teamIds!: Types.ObjectId[];
}

export const TournamentManualQualifierSchema = SchemaFactory.createForClass(
  TournamentManualQualifier,
);

@Schema({
  timestamps: true,
  collection: 'tournaments',
})
export class Tournament {
  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  organizerUserId!: Types.ObjectId;

  /** Everyone who can run the tournament. Seeded with the creator; legacy docs may be empty. */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: User.name }],
    default: [],
  })
  organizerIds!: Types.ObjectId[];

  @Prop({
    type: String,
    enum: Object.values(SportType),
    required: true,
    default: SportType.CRICKET,
  })
  sportType!: SportType;

  @Prop({
    type: String,
    enum: Object.values(TournamentFormat),
    required: true,
  })
  format!: TournamentFormat;

  @Prop({
    type: String,
    enum: Object.values(TournamentStatus),
    required: true,
    default: TournamentStatus.DRAFT,
    index: true,
  })
  status!: TournamentStatus;

  @Prop({ type: Number, min: 1 })
  maxTeams?: number;

  /** Set when the organizer locks the roster; registration closes after this. */
  @Prop({ type: Date })
  rosterLockedAt?: Date;

  @Prop({ type: [String], default: [] })
  coverImages!: string[];

  @Prop({ type: String, trim: true, maxlength: 500 })
  description?: string;

  @Prop({ type: String, trim: true, maxlength: 120 })
  venueName?: string;

  @Prop({ type: Date })
  startDate?: Date;

  @Prop({ type: Date })
  endDate?: Date;

  @Prop({ type: Date })
  registrationDeadline?: Date;

  @Prop({ type: Boolean, default: true, index: true })
  isPublic!: boolean;

  /** Copied onto each fixture session when the scorer starts it. */
  @Prop({ type: Number, required: true, default: 20, min: 1, max: 120 })
  maxOvers!: number;

  @Prop({ type: Number, default: HYBRID_GROUP_SIZE })
  groupSize?: number;

  @Prop({ type: Number, default: HYBRID_ADVANCE_COUNT })
  advanceCount?: number;

  @Prop({ type: [TournamentManualQualifierSchema], default: [] })
  manualQualifiers!: TournamentManualQualifier[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const TournamentSchema = SchemaFactory.createForClass(Tournament);

TournamentSchema.index({ status: 1, sportType: 1, createdAt: -1 });
TournamentSchema.index({ organizerIds: 1 });
