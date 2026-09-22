import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Team } from '../../team/schemas/team.schema';
import { User } from '../../users/schemas/user.schema';

const CricketInningsSummarySchema = new MongooseSchema(
  {
    runs: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    legalBalls: { type: Number, default: 0 },
    battingTeamId: {
      type: MongooseSchema.Types.ObjectId,
      ref: Team.name,
    },
    bowlingTeamId: {
      type: MongooseSchema.Types.ObjectId,
      ref: Team.name,
    },
  },
  { _id: false },
);

/** Per-innings aggregate (cricket). */
export class CricketInningsSummary {
  runs!: number;
  wickets!: number;
  legalBalls!: number;
  battingTeamId?: Types.ObjectId;
  bowlingTeamId?: Types.ObjectId;
}

@Schema({ _id: false })
export class CricketState {
  @Prop({ type: Number, required: true, min: 1, max: 120 })
  maxOvers!: number;

  @Prop({ type: Number, default: 1, min: 1, max: 2 })
  currentInnings!: number;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    required: true,
  })
  battingTeamId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    required: true,
  })
  bowlingTeamId!: Types.ObjectId;

  /** Scoring participant id (registered userId or walk-in guestId). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  strikerUserId?: Types.ObjectId;

  /** Scoring participant id (registered userId or walk-in guestId). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  nonStrikerUserId?: Types.ObjectId;

  /** Scoring participant id (registered userId or walk-in guestId). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  bowlerUserId?: Types.ObjectId;

  /** Live on-field participant ids for fromTeam (empty → starting XI at read time). */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId }],
    default: [],
  })
  fromTeamActiveParticipantIds!: Types.ObjectId[];

  /** Live on-field participant ids for toTeam (empty → starting XI at read time). */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId }],
    default: [],
  })
  toTeamActiveParticipantIds!: Types.ObjectId[];

  @Prop({
    type: [CricketInningsSummarySchema],
    default: () => [{ runs: 0, wickets: 0, legalBalls: 0 }],
  })
  inningsSummaries!: CricketInningsSummary[];
}

export const CricketStateSchema = SchemaFactory.createForClass(CricketState);

export enum FootballPeriod {
  FIRST_HALF = 'first_half',
  SECOND_HALF = 'second_half',
  EXTRA_FIRST = 'extra_first',
  EXTRA_SECOND = 'extra_second',
  PENALTIES = 'penalties',
}

const FootballInningsSummarySchema = new MongooseSchema(
  {
    scoreTeamOne: { type: Number, default: 0, min: 0 },
    scoreTeamTwo: { type: Number, default: 0, min: 0 },
    period: {
      type: String,
      enum: Object.values(FootballPeriod),
    },
  },
  { _id: false },
);

/** Per-innings aggregate (football). */
export class FootballInningsSummary {
  scoreTeamOne!: number;
  scoreTeamTwo!: number;
  period?: FootballPeriod;
}

@Schema({ _id: false })
export class FootballState {
  @Prop({ type: Number, default: 0, min: 0 })
  scoreTeamOne!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  scoreTeamTwo!: number;

  @Prop({ type: Number, default: 1, min: 1, max: 4 })
  currentInnings!: number;

  @Prop({
    type: String,
    enum: Object.values(FootballPeriod),
    default: FootballPeriod.FIRST_HALF,
  })
  currentPeriod!: FootballPeriod;

  @Prop({ type: Number, min: 0, max: 130 })
  matchMinute?: number;

  @Prop({
    type: [FootballInningsSummarySchema],
    default: () => [{ scoreTeamOne: 0, scoreTeamTwo: 0 }],
  })
  inningsSummaries!: FootballInningsSummary[];

  /** Elapsed ms for the current innings only (resets on innings change). */
  @Prop({ type: Number, default: 0, min: 0 })
  timerElapsedMs!: number;

  /** Sum of completed innings [timerElapsedMs] values. */
  @Prop({ type: Number, default: 0, min: 0 })
  totalTimerElapsedMs!: number;

  @Prop({ type: Date })
  timerStartedAt?: Date;

  @Prop({ type: Boolean, default: true })
  isTimerPaused!: boolean;

  /** Live on-field participant ids for fromTeam (empty → starting XI at read time). */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId }],
    default: [],
  })
  fromTeamActiveParticipantIds!: Types.ObjectId[];

  /** Live on-field participant ids for toTeam (empty → starting XI at read time). */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId }],
    default: [],
  })
  toTeamActiveParticipantIds!: Types.ObjectId[];
}

export const FootballStateSchema = SchemaFactory.createForClass(FootballState);
