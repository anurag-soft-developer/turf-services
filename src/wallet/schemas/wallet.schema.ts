import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import type { IWallet, PayoutDetails } from '../interfaces/wallet.interface';

export type WalletDocument = Omit<IWallet, '_id'> &
  Document & {
    createdAt: Date;
    updatedAt: Date;
  };

@Schema({ timestamps: true })
export class Wallet extends Document implements WalletDocument {
  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: true,
    unique: true,
    index: true,
  })
  user!: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  totalBalance!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  heldBalance!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  escrowBalance!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  totalEarnings!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  totalWithdrawn!: number;

  @Prop({
    type: {
      accountHolderName: { type: String, trim: true },
      bankName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      ifscCode: { type: String, trim: true, uppercase: true },
      upiId: { type: String, trim: true, lowercase: true },
    },
    _id: false,
  })
  payoutDetails?: PayoutDetails;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt!: Date;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
