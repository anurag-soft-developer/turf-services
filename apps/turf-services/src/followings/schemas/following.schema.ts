import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type FollowingDocument = Following & Document;

export enum FollowingStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

@Schema({
  timestamps: true,
  collection: 'followings',
})
export class Following {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  requester!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  recipient!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(FollowingStatus),
    default: FollowingStatus.PENDING,
  })
  status!: FollowingStatus;

  /** When set (rejected only), MongoDB TTL deletes the document at this instant. */
  @Prop({ type: Date })
  purgeAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const FollowingSchema = SchemaFactory.createForClass(Following);

FollowingSchema.index({ requester: 1, recipient: 1 }, { unique: true });

FollowingSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

FollowingSchema.index({ requester: 1, status: 1 });
FollowingSchema.index({ recipient: 1, status: 1 });
/** Speeds reverse-edge checks used by friends aggregations. */
FollowingSchema.index({ recipient: 1, requester: 1, status: 1 });
