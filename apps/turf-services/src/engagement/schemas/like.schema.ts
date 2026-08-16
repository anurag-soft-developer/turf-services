import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import {
  ENGAGEMENT_ENTITY_TYPES,
  type EngagementEntityType,
} from '../engagement.constants';

export type LikeDocument = Like & Document;

@Schema({
  timestamps: true,
  collection: 'likes',
})
export class Like {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

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

  createdAt!: Date;
  updatedAt!: Date;
}

export const LikeSchema = SchemaFactory.createForClass(Like);

LikeSchema.index(
  { userId: 1, entityType: 1, entityId: 1 },
  { unique: true },
);
