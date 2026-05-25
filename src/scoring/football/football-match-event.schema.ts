import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, PopulateOptions, Types } from 'mongoose';
import { TeamMatch } from '../../matchmaking/schemas/team-match.schema';
import { Team } from '../../team/schemas/team.schema';
import { User, userSelectFields } from '../../users/schemas/user.schema';
import { FootballPeriod } from '../../matchmaking/schemas/team-match.schema';

export type FootballMatchEventDocument = FootballMatchEvent & Document;

export enum FootballEventKind {
  GOAL = 'goal',
  OWN_GOAL = 'own_goal',
  YELLOW_CARD = 'yellow_card',
  RED_CARD = 'red_card',
  SUBSTITUTION = 'substitution',
  PENALTY_SCORED = 'penalty_scored',
  PENALTY_MISSED = 'penalty_missed',
}

export const FOOTBALL_EVENT_POPULATE: PopulateOptions[] = [
  { path: 'primaryUserId', select: userSelectFields },
  { path: 'secondaryUserId', select: userSelectFields },
];

@Schema({
  timestamps: true,
  collection: 'football-match-events',
})
export class FootballMatchEvent {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: TeamMatch.name,
    required: true,
    index: true,
  })
  teamMatchId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  sequence!: number;

  @Prop({ type: Number, required: true, min: 1, max: 4 })
  innings!: number;

  @Prop({
    type: String,
    enum: Object.values(FootballEventKind),
    required: true,
  })
  kind!: FootballEventKind;

  @Prop({
    type: String,
    enum: Object.values(FootballPeriod),
    required: true,
  })
  period!: FootballPeriod;

  @Prop({ type: Number, min: 0, max: 130 })
  matchMinute?: number;

  /** Team that receives the score change (for goals / own goals). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    required: true,
  })
  beneficiaryTeamId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  primaryUserId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  secondaryUserId?: Types.ObjectId;

  /** Runs added to teamOne / teamTwo totals from this event (0 or 1 for goals). */
  @Prop({ type: Number, default: 0, min: 0 })
  scoreDeltaTeamOne!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  scoreDeltaTeamTwo!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const FootballMatchEventSchema =
  SchemaFactory.createForClass(FootballMatchEvent);

FootballMatchEventSchema.index({ teamMatchId: 1, sequence: 1 }, { unique: true });
FootballMatchEventSchema.index({ teamMatchId: 1, createdAt: 1 });
