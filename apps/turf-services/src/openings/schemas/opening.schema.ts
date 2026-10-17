import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { SportType } from '../../core/sports/sport-types';
import { Team } from '../../team/schemas/team.schema';
import { Tournament } from '../../tournament/schemas/tournament.schema';
import { User } from '../../users/schemas/user.schema';

export type OpeningDocument = Opening & Document;

export enum OpeningType {
  TEAM = 'team',
  TOURNAMENT = 'tournament',
}

export enum OpeningStatus {
  OPEN = 'open',
  ON_HOLD = 'onHold',
  CLOSED = 'closed',
}

export enum OpeningJoinMode {
  OPEN = 'open',
  APPROVAL = 'approval',
}

@Schema({
  timestamps: true,
  collection: 'openings',
})
export class Opening {
  @Prop({
    type: String,
    enum: Object.values(OpeningType),
    required: true,
    index: true,
  })
  type!: OpeningType;

  /** Set when [type] is team. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
  })
  teamId?: Types.ObjectId;

  /** Set when [type] is tournament. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Tournament.name,
  })
  tournamentId?: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  postedBy!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 160 })
  title!: string;

  @Prop({
    type: String,
    enum: Object.values(SportType),
    required: true,
  })
  sportType!: SportType;

  @Prop({
    type: String,
    enum: Object.values(OpeningStatus),
    required: true,
    default: OpeningStatus.OPEN,
    index: true,
  })
  status!: OpeningStatus;

  /** Players always wait for approval. Kept so older rows still load. */
  @Prop({
    type: String,
    enum: Object.values(OpeningJoinMode),
    default: OpeningJoinMode.APPROVAL,
  })
  joinMode!: OpeningJoinMode;

  /** Cap on pending team memberships while this opening is the live one. */
  @Prop({ type: Number, required: true, min: 0, max: 1000, default: 50 })
  maxPendingJoinRequests!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const OpeningSchema = SchemaFactory.createForClass(Opening);

/** Lookups for a host's openings. Several live rows are allowed. */
OpeningSchema.index({ teamId: 1, status: 1 });
OpeningSchema.index({ tournamentId: 1, status: 1 });

OpeningSchema.index({ status: 1, sportType: 1, createdAt: -1 });
