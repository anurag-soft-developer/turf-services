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

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  strikerUserId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  nonStrikerUserId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  bowlerUserId?: Types.ObjectId;

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

@Schema({ _id: false })
export class FootballState {
  @Prop({ type: Number, default: 0, min: 0 })
  scoreTeamOne!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  scoreTeamTwo!: number;

  @Prop({
    type: String,
    enum: Object.values(FootballPeriod),
    default: FootballPeriod.FIRST_HALF,
  })
  currentPeriod!: FootballPeriod;

  @Prop({ type: Number, min: 0, max: 130 })
  matchMinute?: number;
}

export const FootballStateSchema = SchemaFactory.createForClass(FootballState);
