import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { Team } from '../../team/schemas/team.schema';
import { TeamMatch } from '../../matchmaking/schemas/team-match.schema';
import { Turf } from '../../turf/schemas/turf.schema';
import { Media } from './media.schema';
import {
  GeoLocation,
  GeoLocationSchema,
} from '../../core/schemas/geo-location.schema';

export type ContentPostDocument = ContentPost & Document;

export enum PostStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

@Schema({
  timestamps: true,
  collection: 'posts',
})
export class ContentPost {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  postedBy!: Types.ObjectId;

  /** When set, the post is published on behalf of this team (owners only). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    index: true,
  })
  team?: Types.ObjectId;

  /** Optional fixture this post is attached to (match photos). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: TeamMatch.name,
  })
  match?: Types.ObjectId;

  /** Copied from the match’s selected turf at create time; never trusted from the client. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Turf.name,
  })
  turf?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(PostStatus),
    default: PostStatus.DRAFT,
  })
  status!: PostStatus;

  @Prop({ type: String, trim: true, maxlength: 300, default: '' })
  title!: string;

  @Prop({ type: String, trim: true, maxlength: 20000, default: '' })
  content!: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: GeoLocationSchema, required: false })
  location?: GeoLocation;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: Media.name }],
    default: [],
  })
  media!: Types.ObjectId[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const ContentPostSchema = SchemaFactory.createForClass(ContentPost);

ContentPostSchema.index({ status: 1, createdAt: -1 });
ContentPostSchema.index({ team: 1, status: 1, createdAt: -1 });
ContentPostSchema.index({ postedBy: 1, status: 1, createdAt: -1 });
ContentPostSchema.index({ match: 1, status: 1, createdAt: -1 });
ContentPostSchema.index({ turf: 1, status: 1, createdAt: -1 });
ContentPostSchema.index({ 'location.coordinates': '2dsphere' });
