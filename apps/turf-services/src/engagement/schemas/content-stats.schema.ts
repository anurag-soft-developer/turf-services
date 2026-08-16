import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import {
  ENGAGEMENT_ENTITY_TYPES,
  type EngagementEntityType,
} from '../engagement.constants';

export type ContentStatsDocument = ContentStats & Document;

@Schema({
  timestamps: true,
  collection: 'content_stats',
})
export class ContentStats {
  @Prop({
    type: String,
    enum: ENGAGEMENT_ENTITY_TYPES,
    required: true,
  })
  entityType!: EngagementEntityType;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
  })
  entityId!: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  impressions!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  views!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  watchMs!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  likeCount!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ContentStatsSchema = SchemaFactory.createForClass(ContentStats);

ContentStatsSchema.index({ entityType: 1, entityId: 1 }, { unique: true });
