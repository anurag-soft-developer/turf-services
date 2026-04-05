import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { Team } from '../../team/schemas/team.schema';

export type TeamMemberDocument = TeamMember & Document;

export enum TeamMemberStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  RESIGNED = 'resigned',
  REMOVED = 'removed',
  REJECTED = 'rejected',
}

/** Captain / vice-captain; distinct from on-field position. */
export enum LeadershipRole {
  CAPTAIN = 'captain',
  VICE_CAPTAIN = 'vice_captain',
}

/**
 * Whether the player is in the starting lineup or on the bench / extended squad.
 * Avoids cricket-only terms like "playing XI".
 */
export enum LineupCategory {
  STARTER = 'starter',
  SUBSTITUTE = 'substitute',
}

@Schema({
  timestamps: true,
  collection: 'team-members',
})
export class TeamMember {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    required: true,
    index: true,
  })
  team!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  user!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(TeamMemberStatus),
    required: true,
  })
  status!: TeamMemberStatus;

  @Prop({
    type: String,
    enum: Object.values(LeadershipRole),
    required: false,
  })
  leadershipRole?: LeadershipRole;

  /** Sport-specific label, e.g. bowler, midfielder, goalkeeper. */
  @Prop({ type: String, trim: true, maxlength: 80 })
  playingPosition?: string;

  @Prop({
    type: String,
    enum: Object.values(LineupCategory),
    default: LineupCategory.STARTER,
  })
  lineupCategory!: LineupCategory;

  @Prop({ type: Date })
  joinedAt?: Date;

  @Prop({ type: Date })
  leftAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);

/** At most one pending or active stint per user per team; full history via resigned/removed rows. */
TeamMemberSchema.index(
  { team: 1, user: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['pending', 'active'] },
    },
  },
);
TeamMemberSchema.index({ team: 1, status: 1 });
TeamMemberSchema.index({ user: 1, createdAt: -1 });
