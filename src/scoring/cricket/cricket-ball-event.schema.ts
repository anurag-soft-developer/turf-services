import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { ScoringSession } from '../common/scoring-session.schema';

export type CricketBallEventDocument = CricketBallEvent & Document;

export enum CricketWicketKind {
  BOWLED = 'bowled',
  CAUGHT = 'caught',
  LBW = 'lbw',
  RUN_OUT = 'run_out',
  STUMPED = 'stumped',
  HIT_WICKET = 'hit_wicket',
  OTHER = 'other',
}

@Schema({
  timestamps: true,
  collection: 'cricket-ball-events',
})
export class CricketBallEvent {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: ScoringSession.name,
    required: true,
    index: true,
  })
  sessionId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  sequence!: number;

  @Prop({ type: Number, required: true, min: 1, max: 2 })
  innings!: number;

  @Prop({ type: Number, required: true, min: 0 })
  overAfter!: number;

  @Prop({ type: Number, required: true, min: 1, max: 6 })
  ballInOverAfter!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  strikerUserId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  nonStrikerUserId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  bowlerUserId!: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  runsOffBat!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  extrasWide!: number;

  @Prop({ type: Boolean, default: false })
  extrasNoBall!: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  extrasBye!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  extrasLegBye!: number;

  @Prop({ type: Boolean, default: false })
  isWicket!: boolean;

  @Prop({ type: String, enum: Object.values(CricketWicketKind) })
  wicketKind?: CricketWicketKind;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  dismissedUserId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  primaryFielderUserId?: Types.ObjectId;

  /** Total runs added to batting innings from this delivery (including extras). */
  @Prop({ type: Number, required: true, min: 0 })
  totalRunsOnDelivery!: number;

  @Prop({ type: Boolean, required: true })
  isLegalDelivery!: boolean;

  @Prop({ type: Number, default: 0, min: 0, max: 1 })
  wicketsFallen!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const CricketBallEventSchema =
  SchemaFactory.createForClass(CricketBallEvent);

CricketBallEventSchema.index({ sessionId: 1, sequence: 1 }, { unique: true });
CricketBallEventSchema.index({ sessionId: 1, createdAt: 1 });
