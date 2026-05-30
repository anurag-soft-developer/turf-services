import { Types } from 'mongoose';

export interface PayoutDetails {
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
