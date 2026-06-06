import { Types } from 'mongoose';

export enum PayoutMethod {
  UPI = 'upi',
  BANK = 'bank',
}

export enum WalletType {
  TURF = 'turf',
  EVENT = 'event',
}

export interface PayoutDetails {
  primaryMethod?: PayoutMethod;
  accountHolderName?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  upiId?: string;
}

export interface IWalletLaneBalance {
  totalBalance: number;
  heldBalance: number;
  escrowBalance: number;
  totalEarnings: number;
  totalWithdrawn: number;
}

export interface IWallet {
  _id: string;
  user: Types.ObjectId;
  turfWallet: IWalletLaneBalance;
  eventWallet: IWalletLaneBalance;
  payoutDetails?: PayoutDetails;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWalletResponse extends IWallet {
  availableBalance: number;
  turfAvailableBalance: number;
  eventAvailableBalance: number;
}
