import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import {
  ISupportInternalNote,
  ISupportQuery,
  ISupportReply,
  SupportQueryStatus,
  SupportReplyAuthorRole,
} from '../interfaces/support.interface';

export type SupportQueryDocument = Omit<ISupportQuery, '_id'> &
  Document & {
    createdAt: Date;
    updatedAt: Date;
  };

@Schema({ _id: true })
class SupportReply implements ISupportReply {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  authorId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(SupportReplyAuthorRole),
    required: true,
  })
  authorRole!: SupportReplyAuthorRole;

  @Prop({ type: String, required: true, trim: true, maxlength: 4000 })
  body!: string;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;
}

@Schema({ _id: true })
class SupportInternalNote implements ISupportInternalNote {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  authorId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 4000 })
  body!: string;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;
}

@Schema({ timestamps: true, collection: 'support_queries' })
export class SupportQuery extends Document implements SupportQueryDocument {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, lowercase: true, trim: true })
  email?: string;

  @Prop({ type: String, trim: true })
  phone?: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  subject!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 4000 })
  message!: string;

  @Prop({
    type: String,
    enum: Object.values(SupportQueryStatus),
    default: SupportQueryStatus.OPEN,
    index: true,
  })
  status!: SupportQueryStatus;

  @Prop({ type: [SupportReply], default: [] })
  replies!: ISupportReply[];

  @Prop({ type: [SupportInternalNote], default: [] })
  internalNotes!: ISupportInternalNote[];

  @Prop({ type: Types.ObjectId, ref: User.name })
  resolvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  resolvedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt!: Date;
}

export const SupportQuerySchema = SchemaFactory.createForClass(SupportQuery);
SupportQuerySchema.index({ userId: 1, createdAt: -1 });
SupportQuerySchema.index({ status: 1, createdAt: -1 });
