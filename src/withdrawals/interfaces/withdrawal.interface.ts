import { Types } from 'mongoose';

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

export interface IWithdrawalRequest {
  _id: string;
  requestedBy: Types.ObjectId;
  amount: number;
  status: WithdrawalStatus;
  comments: IWithdrawalComment[];
  attachments: string[];
  rejectionReason?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
