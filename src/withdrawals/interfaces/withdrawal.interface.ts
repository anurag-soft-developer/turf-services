import { Types } from 'mongoose';
import {
  PayoutDetails,
  PayoutMethod,
} from '../../wallet/interfaces/wallet.interface';

export enum WithdrawalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PROCESSING = 'processing',
  SETTLED = 'settled',
  CANCELLED = 'cancelled',
}

export interface IWithdrawalComment {
  addedBy: Types.ObjectId;
  message: string;
  createdAt: Date;
}

export interface PayoutSnapshot {
  method: PayoutMethod;
  accountHolderName?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  upiId?: string;
}

export interface IWithdrawalRequest {
  _id: string;
  requestedBy: Types.ObjectId;
  amount: number;
  status: WithdrawalStatus;
  comments: IWithdrawalComment[];
  attachments: string[];
  payoutSnapshot?: PayoutSnapshot;
  rejectionReason?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Included on admin GET withdrawal responses only. */
export interface IWithdrawalAdminResponse extends IWithdrawalRequest {
  hostPayoutDetails?: PayoutDetails;
}
