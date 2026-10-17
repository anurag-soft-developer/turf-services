import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { Opening, OpeningType } from '../../openings/schemas/opening.schema';
import { Team } from '../../team/schemas/team.schema';
import { Tournament } from '../../tournament/schemas/tournament.schema';
import { User } from '../../users/schemas/user.schema';

export type EnrollmentDocument = Enrollment & Document;

export enum EnrollmentStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

@Schema({
  timestamps: true,
  collection: 'enrollments',
})
export class Enrollment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Opening.name,
    required: true,
    index: true,
  })
  openingId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(OpeningType),
    required: true,
  })
  subjectType!: OpeningType;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  user!: Types.ObjectId;

  /**
   * Team opening: the team being joined.
   * Tournament opening: the team being entered.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    index: true,
  })
  teamId?: Types.ObjectId;

  /** Set when [subjectType] is tournament. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Tournament.name,
    index: true,
  })
  tournamentId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(EnrollmentStatus),
    required: true,
    default: EnrollmentStatus.PENDING,
    index: true,
  })
  status!: EnrollmentStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);

/** One pending player request per team opening. */
EnrollmentSchema.index(
  { openingId: 1, user: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: EnrollmentStatus.PENDING,
      subjectType: OpeningType.TEAM,
    },
  },
);

/** One pending team entry per tournament opening. */
EnrollmentSchema.index(
  { openingId: 1, teamId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: EnrollmentStatus.PENDING,
      subjectType: OpeningType.TOURNAMENT,
      teamId: { $exists: true },
    },
  },
);

EnrollmentSchema.index({ user: 1, status: 1, createdAt: -1 });
EnrollmentSchema.index({ openingId: 1, status: 1, createdAt: -1 });
