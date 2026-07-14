import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Document,
  Schema as MongooseSchema,
  PopulateOptions,
  Types,
} from 'mongoose';
import { TeamMatch } from '../../matchmaking/schemas/team-match.schema';
import { User, userSelectFields } from '../../users/schemas/user.schema';
import { TEAM_MATCH_POPULATE } from '../../matchmaking/util/matchmaking.constants';

export type CricketOverEventDocument = CricketOverEvent & Document;

export enum CricketWicketKind {
  BOWLED = 'bowled',
  CAUGHT = 'caught',
  LBW = 'lbw',
  RUN_OUT = 'run_out',
  STUMPED = 'stumped',
  HIT_WICKET = 'hit_wicket',
  OTHER = 'other',
}

/** One delivery within an over (embedded in `CricketOverEvent.ballEvents`). */
@Schema({ _id: false })
export class CricketBallEvent {
  @Prop({ type: Number, required: true, min: 1, max: 6 })
  ballInOverAfter!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  strikerUserId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  nonStrikerUserId!: Types.ObjectId;

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
}

export const CricketBallEventSchema =
  SchemaFactory.createForClass(CricketBallEvent);

@Schema({
  timestamps: true,
  collection: 'cricket-over-events',
})
export class CricketOverEvent {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: TeamMatch.name,
    required: true,
    index: true,
  })
  teamMatchId!: Types.ObjectId;

  /** Bowler for every delivery in this over. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  bowlerUserId!: Types.ObjectId;

  /** Monotonic over index for this match (first over = 1, …). */
  @Prop({ type: Number, required: true, min: 1 })
  sequence!: number;

  @Prop({ type: Number, required: true, min: 1, max: 2 })
  innings!: number;

  @Prop({ type: Number, required: true, min: 0 })
  overAfter!: number;

  @Prop({ type: [CricketBallEventSchema], default: [] })
  ballEvents!: CricketBallEvent[];
}

export const CricketOverEventSchema =
  SchemaFactory.createForClass(CricketOverEvent);

CricketOverEventSchema.index(
  { teamMatchId: 1, innings: 1, overAfter: 1 },
  { unique: true },
);
CricketOverEventSchema.index({ teamMatchId: 1, sequence: 1 });
CricketOverEventSchema.index({ teamMatchId: 1, createdAt: 1 });

export const CRICKET_OVER_EVENT_POPULATE: PopulateOptions[] = [
  { path: 'teamMatchId', populate: TEAM_MATCH_POPULATE },
  { path: 'bowlerUserId', select: userSelectFields },
  { path: 'ballEvents.strikerUserId', select: userSelectFields },
  { path: 'ballEvents.nonStrikerUserId', select: userSelectFields },
  { path: 'ballEvents.dismissedUserId', select: userSelectFields },
  { path: 'ballEvents.primaryFielderUserId', select: userSelectFields },
];
