import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { Team, SportType } from '../../team/schemas/team.schema';
import { Turf } from '../../turf/schemas/turf.schema';
import { User } from '../../users/schemas/user.schema';

export type TeamMatchDocument = TeamMatch & Document;

/** How the match record was created (e.g. feed challenge). */
export enum TeamMatchSource {
  FEED = 'feed',
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
  decidedByTeamId?: Types.ObjectId;
  decidedAt?: Date;
  reason?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

@Schema({
  timestamps: true,
  collection: 'team-matches',
})
export class TeamMatch {
  @Prop({
    type: String,
    enum: Object.values(TeamMatchSource),
    default: TeamMatchSource.FEED,
  })
  source!: TeamMatchSource;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    required: true,
    index: true,
  })
  fromTeam!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    required: true,
    index: true,
  })
  toTeam!: Types.ObjectId;

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
        decidedByTeamId: { type: MongooseSchema.Types.ObjectId, ref: Team.name },
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
        decidedByTeamId: { type: MongooseSchema.Types.ObjectId, ref: Team.name },
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

  /** Set when status is `completed`; omit for `draw`. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Team.name })
  winnerTeam?: Types.ObjectId;

  @Prop({ type: String, trim: true, maxlength: 500 })
  notes?: string;

  @Prop({ type: Date})
  expiresAt?: Date;

  @Prop({ type: Date })
  closedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TeamMatchSchema = SchemaFactory.createForClass(TeamMatch);

const ACTIVE_PAIR_STATUSES = [
  TeamMatchStatus.REQUESTED,
  TeamMatchStatus.ACCEPTED,
  TeamMatchStatus.NEGOTIATING,
];

TeamMatchSchema.index({ fromTeam: 1, status: 1, createdAt: -1 });
TeamMatchSchema.index({ toTeam: 1, status: 1, createdAt: -1 });
TeamMatchSchema.index(
  { fromTeam: 1, toTeam: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ACTIVE_PAIR_STATUSES },
    },
  },
);
