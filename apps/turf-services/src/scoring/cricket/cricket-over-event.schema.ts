import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Document,
  Schema as MongooseSchema,
  PopulateOptions,
  Types,
} from 'mongoose';
import { TeamMatch } from '../../matchmaking/schemas/team-match.schema';
import { Team } from '../../team/schemas/team.schema';
import { User } from '../../users/schemas/user.schema';
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

export enum CricketScoringEntryKind {
  BALL = 'ball',
  SUBSTITUTION = 'substitution',
}

/** Ball delivery fields shared by `kind: ball` scoring entries. */
export type CricketBallPayload = {
  ballInOverAfter: number;
  strikerUserId: Types.ObjectId;
  nonStrikerUserId: Types.ObjectId;
  runsOffBat: number;
  extrasWide: number;
  extrasNoBall: boolean;
  extrasBye: number;
  extrasLegBye: number;
  isWicket: boolean;
  wicketKind?: CricketWicketKind;
  dismissedUserId?: Types.ObjectId;
  primaryFielderUserId?: Types.ObjectId;
  totalRunsOnDelivery: number;
  isLegalDelivery: boolean;
  wicketsFallen: number;
};

/** Discriminated scoring entry stored in `CricketOverEvent.events[]`. */
@Schema({ _id: false })
export class CricketScoringEntry {
  @Prop({
    type: String,
    enum: Object.values(CricketScoringEntryKind),
    required: true,
  })
  kind!: CricketScoringEntryKind;

  /** Server-set append time; source of truth for global timeline / undo. */
  @Prop({ type: Date, required: true })
  recordedAt!: Date;

  // --- kind: ball ---
  @Prop({ type: Number, min: 1, max: 6 })
  ballInOverAfter?: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  strikerUserId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  nonStrikerUserId?: Types.ObjectId;

  @Prop({ type: Number, min: 0 })
  runsOffBat?: number;

  @Prop({ type: Number, min: 0 })
  extrasWide?: number;

  @Prop({ type: Boolean })
  extrasNoBall?: boolean;

  @Prop({ type: Number, min: 0 })
  extrasBye?: number;

  @Prop({ type: Number, min: 0 })
  extrasLegBye?: number;

  @Prop({ type: Boolean })
  isWicket?: boolean;

  @Prop({ type: String, enum: Object.values(CricketWicketKind) })
  wicketKind?: CricketWicketKind;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  dismissedUserId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  primaryFielderUserId?: Types.ObjectId;

  @Prop({ type: Number, min: 0 })
  totalRunsOnDelivery?: number;

  @Prop({ type: Boolean })
  isLegalDelivery?: boolean;

  @Prop({ type: Number, min: 0, max: 1 })
  wicketsFallen?: number;

  // --- kind: substitution ---
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Team.name })
  teamId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  playerOffParticipantId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  playerOnParticipantId?: Types.ObjectId;
}

export const CricketScoringEntrySchema =
  SchemaFactory.createForClass(CricketScoringEntry);

/** Narrowed ball entry (after `kind === ball` filter). */
export type CricketBallEvent = CricketScoringEntry &
  CricketBallPayload & {
    kind: CricketScoringEntryKind.BALL;
  };

export type CricketSubstitutionEvent = CricketScoringEntry & {
  kind: CricketScoringEntryKind.SUBSTITUTION;
  teamId: Types.ObjectId;
  playerOffParticipantId: Types.ObjectId;
  playerOnParticipantId: Types.ObjectId;
};

export function isCricketBallEntry(
  e: CricketScoringEntry,
): e is CricketBallEvent {
  return e.kind === CricketScoringEntryKind.BALL;
}

export function isCricketSubstitutionEntry(
  e: CricketScoringEntry,
): e is CricketSubstitutionEvent {
  return e.kind === CricketScoringEntryKind.SUBSTITUTION;
}

export function ballEventsOf(
  over: { events?: CricketScoringEntry[] },
): CricketBallEvent[] {
  return (over.events ?? []).filter(isCricketBallEntry);
}

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

  /**
   * Bowler for ball deliveries in this over.
   * Optional for substitution-only placeholder over docs.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  bowlerUserId?: Types.ObjectId;

  /** Monotonic over-doc index for this match (first over = 1, …). */
  @Prop({ type: Number, required: true, min: 1 })
  sequence!: number;

  @Prop({ type: Number, required: true, min: 1, max: 2 })
  innings!: number;

  @Prop({ type: Number, required: true, min: 0 })
  overAfter!: number;

  @Prop({ type: [CricketScoringEntrySchema], default: [] })
  events!: CricketScoringEntry[];
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
  // Participant ids (userId or guestId) — leave as ObjectIds; clients resolve
  // names from announcedPlayers. Populating as User nulls walk-in guests.
];
