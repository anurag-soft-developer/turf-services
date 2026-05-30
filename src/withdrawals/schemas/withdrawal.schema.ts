import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  IWithdrawalRequest,
  WithdrawalStatus,
} from '../interfaces/withdrawal.interface';
import { User } from '../../users/schemas/user.schema';

export type WithdrawalDocument = Omit<IWithdrawalRequest, '_id'> &
  Document & {
    createdAt: Date;
    updatedAt: Date;
  };

@Schema({ _id: false })
class WithdrawalComment {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  addedBy!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 1000 })
  message!: string;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;
}

@Schema({ timestamps: true })
export class Withdrawal extends Document implements WithdrawalDocument {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  requestedBy!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  amount!: number;

  @Prop({
    type: String,
    enum: Object.values(WithdrawalStatus),
    default: WithdrawalStatus.PENDING,
    index: true,
  })
  status!: WithdrawalStatus;

  @Prop({ type: [WithdrawalComment], default: [] })
  comments!: WithdrawalComment[];

  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (value: string[]) => value.length <= 10,
      message: 'A maximum of 10 attachments are allowed',
    },
  })
  attachments!: string[];

  @Prop({ type: String, trim: true, maxlength: 1000 })
  rejectionReason?: string;

  @Prop({ type: Types.ObjectId, ref: User.name })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ type: Date })
  processedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt!: Date;
}

export const WithdrawalSchema = SchemaFactory.createForClass(Withdrawal);
WithdrawalSchema.index({ requestedBy: 1, createdAt: -1 });
