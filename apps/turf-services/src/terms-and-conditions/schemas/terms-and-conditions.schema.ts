import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import {
  ITermsAndConditions,
  TermsAndConditionsKind,
  TermsAndConditionsStatus,
} from '../interfaces/terms-and-conditions.interface';

export type TermsAndConditionsDocument = Omit<ITermsAndConditions, '_id'> &
  Document & {
    createdAt: Date;
    updatedAt: Date;
  };

@Schema({ timestamps: true, collection: 'terms_and_conditions' })
export class TermsAndConditions
  extends Document
  implements TermsAndConditionsDocument
{
  @Prop({
    type: String,
    enum: Object.values(TermsAndConditionsKind),
    required: true,
    index: true,
  })
  kind!: TermsAndConditionsKind;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  version!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 50000 })
  content!: string;

  @Prop({
    type: String,
    enum: Object.values(TermsAndConditionsStatus),
    default: TermsAndConditionsStatus.DRAFT,
    index: true,
  })
  status!: TermsAndConditionsStatus;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name })
  publishedBy?: Types.ObjectId;

  @Prop({ type: Date })
  publishedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt!: Date;
}

export const TermsAndConditionsSchema =
  SchemaFactory.createForClass(TermsAndConditions);

TermsAndConditionsSchema.index({ kind: 1, version: 1 }, { unique: true });
TermsAndConditionsSchema.index({ kind: 1, status: 1, publishedAt: -1, _id: -1 });
