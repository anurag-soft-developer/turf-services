import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { TurfBooking } from '../../turf-booking/schemas/turf-booking.schema';
import { Team, SportType } from '../../team/schemas/team.schema';
import { Turf } from '../../turf/schemas/turf.schema';
import { User } from '../../users/schemas/user.schema';
import {
  AnnouncedPlayer,
  AnnouncedPlayerSchema,
} from '../announcedPlayers/announced-players.schema';
import {
  CricketState,
  CricketStateSchema,
  FootballState,
  FootballStateSchema,
} from './team-match-scoring.embedded';
import {
  GeoLocation,
  GeoLocationSchema,
} from '../../core/schemas/geo-location.schema';

export type TeamMatchDocument = TeamMatch & Document;

export {
  AnnouncedPlayer,
  AnnouncedPlayerRole,
  AnnouncedPlayerSchema,
} from '../announcedPlayers/announced-players.schema';

export {
  CricketState,
  CricketStateSchema,
  FootballInningsSummary,
  FootballPeriod,
  FootballState,
  FootballStateSchema,
} from './team-match-scoring.embedded';

/** Ranked challenge vs unranked match. */
export enum TeamMatchSource {
  RANKED = 'ranked',
  UNRANKED = 'unranked',
}

/**
 * Single lifecycle status for the whole record: request → schedule → play → outcome.
 * `fromTeam` implied consent when status is `requested` (they sent the request).
 */
export enum TeamMatchStatus {
  REQUESTED = 'requested',
  ACCEPTED = 'accepted',
  NEGOTIATING = 'negotiating',
  SCHEDULE_FINALIZED = 'schedule_finalized',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  DRAW = 'draw',
  ABANDONED = 'abandoned',
}

export enum MatchProposalStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
  EXPIRED = 'expired',
}

export class TimeSlotRange {
  startTime!: Date;
  endTime!: Date;
}

export class ProposedSlot {
  proposalId!: Types.ObjectId;
  slot!: TimeSlotRange;
  proposedByTeamId!: Types.ObjectId;
  status!: MatchProposalStatus;
  /** For normal flow, the other team accepts; staff `update` may set this equal to `proposedByTeamId`. */
  decidedByTeamId?: Types.ObjectId;
  decidedAt?: Date;
  reason?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ProposedTurf {
  proposalId!: Types.ObjectId;
  turfId!: Types.ObjectId;
  proposedByTeamId!: Types.ObjectId;
  status!: MatchProposalStatus;
  /** For normal flow, the other team accepts; staff `update` may set this equal to `proposedByTeamId`. */
  decidedByTeamId?: Types.ObjectId;
  decidedAt?: Date;
  reason?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

/** Lets outsiders self-join an unranked match as temporary guests. Unranked only. */
@Schema({ _id: false })
export class GuestJoinSettings {
  @Prop({ type: Boolean, default: false })
  fromTeamOpen!: boolean;

  @Prop({ type: Boolean, default: false })
  toTeamOpen!: boolean;

  /** Counts every announced player on a side, not just guests. 0 disables the cap. */
  @Prop({ type: Number, default: 0, min: 0 })
  maxPerTeam!: number;
}

export const GuestJoinSettingsSchema =
  SchemaFactory.createForClass(GuestJoinSettings);

@Schema({
  timestamps: true,
  collection: 'team-matches',
})
export class TeamMatch {
  @Prop({
    type: String,
    enum: Object.values(TeamMatchSource),
    default: TeamMatchSource.RANKED,
  })
  source!: TeamMatchSource;

  /** Empty on a knockout slot that is still waiting for a team. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    index: true,
  })
  fromTeam?: Types.ObjectId;

  /** Empty on a knockout slot that is still waiting for a team. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    index: true,
  })
  toTeam?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(SportType),
    required: true,
    index: true,
  })
  sportType!: SportType;

  @Prop({
    type: String,
    enum: Object.values(TeamMatchStatus),
    default: TeamMatchStatus.REQUESTED,
    index: true,
  })
  status!: TeamMatchStatus;

  /** User who last changed `status` (omit for system-only transitions like TTL expiry). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  statusUpdatedBy?: Types.ObjectId;

  @Prop({ type: Date })
  statusUpdatedAt?: Date;

  @Prop({
    type: [
      {
        proposalId: { type: MongooseSchema.Types.ObjectId, auto: true },
        slot: {
          startTime: { type: Date, required: true },
          endTime: { type: Date, required: true },
        },
        proposedByTeamId: {
          type: MongooseSchema.Types.ObjectId,
          ref: Team.name,
          required: true,
        },
        status: {
          type: String,
          enum: Object.values(MatchProposalStatus),
          default: MatchProposalStatus.PENDING,
        },
        decidedByTeamId: {
          type: MongooseSchema.Types.ObjectId,
          ref: Team.name,
        },
        decidedAt: { type: Date },
        reason: { type: String, trim: true, maxlength: 300 },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    _id: false,
    default: [],
  })
  proposedSlots!: ProposedSlot[];

  @Prop({
    type: [
      {
        proposalId: { type: MongooseSchema.Types.ObjectId, auto: true },
        turfId: {
          type: MongooseSchema.Types.ObjectId,
          ref: Turf.name,
          required: true,
        },
        proposedByTeamId: {
          type: MongooseSchema.Types.ObjectId,
          ref: Team.name,
          required: true,
        },
        status: {
          type: String,
          enum: Object.values(MatchProposalStatus),
          default: MatchProposalStatus.PENDING,
        },
        decidedByTeamId: {
          type: MongooseSchema.Types.ObjectId,
          ref: Team.name,
        },
        decidedAt: { type: Date },
        reason: { type: String, trim: true, maxlength: 300 },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    _id: false,
    default: [],
  })
  proposedTurfs!: ProposedTurf[];

  @Prop({ type: MongooseSchema.Types.ObjectId })
  selectedSlotProposalId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  selectedTurfProposalId?: Types.ObjectId;

  /** Copied from the selected turf when schedule is set. Server-only. */
  @Prop({ type: GeoLocationSchema, required: false })
  venueLocation?: GeoLocation;

  /** Set when status is `completed`; omit for `draw`. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Team.name })
  winnerTeam?: Types.ObjectId;

  @Prop({ type: String, trim: true, maxlength: 500 })
  notes?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: TurfBooking.name,
    index: true,
  })
  turfBookingId?: Types.ObjectId;

  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({ type: Date })
  closedAt?: Date;

  /** Playing XI + substitutes announced for the fixture (e.g. cricket). */
  @Prop({ type: [AnnouncedPlayerSchema], default: [] })
  announcedPlayers!: AnnouncedPlayer[];

  @Prop({
    type: GuestJoinSettingsSchema,
    default: () => ({ fromTeamOpen: false, toTeamOpen: false, maxPerTeam: 0 }),
  })
  guestJoin!: GuestJoinSettings;

  @Prop({ type: CricketStateSchema, required: false })
  cricketState?: CricketState;

  @Prop({ type: FootballStateSchema, required: false })
  footballState?: FootballState;

  /** Set when this match was created as a tournament fixture. Normal matches leave these empty. */
  @Prop({ type: MongooseSchema.Types.ObjectId, index: true })
  tournamentId?: Types.ObjectId;

  @Prop({ type: String, enum: ['group', 'knockout', 'league'] })
  stage?: 'group' | 'knockout' | 'league';

  @Prop({ type: Number })
  round?: number;

  @Prop({ type: String, trim: true })
  groupLabel?: string;

  @Prop({ type: Number })
  matchNumber?: number;

  /** Earlier fixture numbers whose winners fill this match. Empty on the opening round. */
  @Prop({ type: [Number] })
  sourceMatchNumbers?: number[];

  /** Stable id for a hybrid semi or final so it can be updated when qualifiers change. */
  @Prop({ type: String, trim: true })
  bracketKey?: string;

  /**
   * Winner chosen only to advance a knockout bracket after a drawn match.
   * Does not change `winnerTeam`, match status, or ranking points.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Team.name })
  tournamentBracketWinner?: Types.ObjectId;

  /**
   * Owners and active members of both teams, copied once when this fixture starts.
   * Later roster changes do not add or remove ids.
   */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: User.name }] })
  associatedUserIds?: Types.ObjectId[];

  /** Set when ranking points from this match have been applied to teams/players. */
  @Prop({ type: Date })
  rankingPointsAppliedAt?: Date;

  @Prop({ type: MongooseSchema.Types.Mixed })
  rankingPointsSnapshot?: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TeamMatchSchema = SchemaFactory.createForClass(TeamMatch);

TeamMatchSchema.index(
  { 'venueLocation.coordinates': '2dsphere' },
  { sparse: true },
);
TeamMatchSchema.index({ fromTeam: 1, status: 1, createdAt: -1 });
TeamMatchSchema.index({ toTeam: 1, status: 1, createdAt: -1 });
TeamMatchSchema.index({ fromTeam: 1, toTeam: 1, status: 1, createdAt: -1 });
TeamMatchSchema.index(
  { tournamentId: 1, matchNumber: 1 },
  { unique: true, sparse: true },
);
TeamMatchSchema.index({ associatedUserIds: 1, tournamentId: 1 });
