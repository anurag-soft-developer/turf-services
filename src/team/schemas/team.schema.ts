import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import {
  GeoLocation,
  GeoLocationSchema,
} from '../../core/schemas/geo-location.schema';
import type { EarnedBadge } from '../../core/badges/badges';

export type TeamDocument = Team & Document;

/** Stored as string; extend when adding sports. */
export enum SportType {
  CRICKET = 'cricket',
  FOOTBALL = 'football',
}

export enum TeamVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

/** Only applies when visibility is public; private teams always use approval. */
export enum TeamJoinMode {
  OPEN = 'open',
  APPROVAL = 'approval',
}

export enum TeamStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum TeamGenderCategory {
  MALE = 'male',
  FEMALE = 'female',
  MIXED = 'mixed',
}

export enum TeamPreferredTimeSlot {
  MORNING = 'morning',
  AFTERNOON = 'afternoon',
  EVENING = 'evening',
}

export class TeamSocialLinks {
  instagram?: string;
  twitter?: string;
  facebook?: string;
  youtube?: string;
}

export interface FootballStats {
  goalsScored: number;
  goalsConceded: number;
  /** Goals scored from the penalty spot. */
  penaltyGoalsScored: number;
  /** Penalties missed or saved against the team. */
  penaltiesMissed: number;
  /** Matches where the opponent scored 0. */
  cleanSheets: number;
  yellowCards: number;
  redCards: number;
}

export interface CricketStats {
  totalRunsScored: number;
  totalRunsConceded: number;
  totalWicketsTaken: number;
  highestTeamScore: number;
  lowestTeamScore: number;
  /** Wides + no-balls + byes conceded. */
  totalExtras: number;
  /** Number of times the full side was dismissed. */
  timesAllOut: number;
}

/**
 * Keyed by SportType value; only the team's own sport key will be populated.
 * Stored as Mixed so adding a new sport requires no schema migration —
 * just define a new interface and start writing to the new key.
 */
export type SportStatsMap = {
  [SportType.FOOTBALL]?: FootballStats;
  [SportType.CRICKET]?: CricketStats;
};

export type { EarnedBadge, BadgeDefinition } from '../../core/badges/badges';
export { BADGE_DEFINITIONS, evaluateBadges } from '../../core/badges/badges';

/**
 * Sport-specific roster bounds for India.
 * Cricket: playing XI (11) + up to 4 extras = 15.
 * Football: covers 5-a-side through 11-a-side + 7 substitutes = 18.
 * Use these in DTOs/services to validate and default rosterSize values.
 */
export const SPORT_ROSTER_CONFIG: Record<
  SportType,
  { min: number; max: number }
> = {
  [SportType.CRICKET]: { min: 11, max: 15 },
  [SportType.FOOTBALL]: { min: 5, max: 18 },
};

/** Fields loaded when populating `team` on memberships (e.g. roster lists). */
export const teamPopulateSelectFields =
  '_id name logo location sportType';

@Schema({
  timestamps: true,
  collection: 'team',
})
export class Team {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, trim: true, maxlength: 10 })
  shortName?: string;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ type: String, trim: true, maxlength: 160 })
  tagline?: string;

  @Prop({
    type: {
      instagram: { type: String, trim: true },
      twitter: { type: String, trim: true },
      facebook: { type: String, trim: true },
      youtube: { type: String, trim: true },
    },
    _id: false,
    default: {},
  })
  socialLinks!: TeamSocialLinks;

  @Prop({ type: Number, min: 1800, max: 2100 })
  foundedYear?: number;

  @Prop({
    type: String,
    enum: Object.values(SportType),
    required: true,
  })
  sportType!: SportType;

  @Prop({
    type: String,
    enum: Object.values(TeamGenderCategory),
  })
  genderCategory?: TeamGenderCategory;

  @Prop({ type: GeoLocationSchema, required: false })
  location?: GeoLocation;

  @Prop({
    type: String,
    enum: Object.values(TeamVisibility),
    required: true,
  })
  visibility!: TeamVisibility;

  @Prop({
    type: String,
    enum: Object.values(TeamJoinMode),
    default: TeamJoinMode.APPROVAL,
  })
  joinMode!: TeamJoinMode;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  createdBy!: Types.ObjectId;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: User.name }],
    default: [],
  })
  ownerIds!: Types.ObjectId[];

  @Prop({ type: String, trim: true, default: '' })
  logo!: string;

  @Prop({ type: [String], default: [] })
  coverImages!: string[];

  @Prop({ type: Number, required: true, min: 0, max: 1000 })
  maxPendingJoinRequests!: number;

  @Prop({
    type: String,
    enum: Object.values(TeamStatus),
    default: TeamStatus.ACTIVE,
  })
  status!: TeamStatus;

  @Prop({ type: Date })
  disabledAt?: Date;

  /** User-defined discovery tags e.g. "casual", "weekend-only", "corporates". */
  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: [String], default: [] })
  preferredPlayDays!: string[];

  @Prop({
    type: String,
    enum: Object.values(TeamPreferredTimeSlot),
  })
  preferredTimeSlot?: TeamPreferredTimeSlot;

  @Prop({ type: Boolean, default: false })
  lookingForMembers!: boolean;

  @Prop({ type: Boolean, default: false })
  teamOpenForMatch!: boolean;

  /** Pinned announcements shown on the team page. */
  @Prop({ type: [String], default: [] })
  pinnedNotices!: string[];

  @Prop({ type: Number, default: 0, min: 0 })
  matchesPlayed!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  wins!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  losses!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  draws!: number;

  /** Win rate as a fraction (0–1); update whenever wins/losses/draws change. */
  @Prop({ type: Number, default: 0, min: 0, max: 1 })
  winRate!: number;

  /**
   * Sport-specific statistics keyed by sport name.
   * Only the key matching the team's sportType will be populated.
   * Stored as Mixed to allow adding new sports without schema migration.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  sportStats!: SportStatsMap;

  /**
   * Badges earned by the team.
   * Populated by evaluateBadges() after match results are recorded.
   */
  @Prop({
    type: [{ badgeId: { type: String }, earnedAt: { type: Date } }],
    _id: false,
    default: [],
  })
  badges!: EarnedBadge[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const TeamSchema = SchemaFactory.createForClass(Team);

TeamSchema.index(
  { 'location.coordinates': '2dsphere' },
  { sparse: true },
);
TeamSchema.index({ visibility: 1, status: 1, sportType: 1 });
TeamSchema.index({ createdBy: 1 });
TeamSchema.index({ ownerIds: 1 });
TeamSchema.index({ lookingForMembers: 1, status: 1 });
TeamSchema.index({ teamOpenForMatch: 1, status: 1, sportType: 1 });
TeamSchema.index({ tags: 1 });
