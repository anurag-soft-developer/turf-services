import { Types } from 'mongoose';

export enum PayoutMethod {
  UPI = 'upi',
  BANK = 'bank',
}

export interface PayoutDetails {
  primaryMethod?: PayoutMethod;
  accountHolderName?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  upiId?: string;
}

export interface IWallet {
  _id: string;
  user: Types.ObjectId;
  totalBalance: number;
  heldBalance: number;
  escrowBalance: number;
  totalEarnings: number;
  totalWithdrawn: number;
  payoutDetails?: PayoutDetails;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWalletResponse extends IWallet {
  availableBalance: number;
}
