import { Types } from 'mongoose';

export interface IEventBooking {
  _id: string;
  event: Types.ObjectId;
  bookedBy: Types.ObjectId;
  fullName: string;
  contactNumber: string;
  notes?: string;
  playerCount?: number;
  totalAmount: number;
  status: EventBookingStatus;
  paymentStatus: PaymentStatus;
  paymentId?: string;
  razorpayOrderId?: string;
  platformFeeAmount?: number;
  organizerPayoutAmount?: number;
  invoiceId?: string;
  paidAt?: string | Date;
  escrowCreditedAt?: string | Date;
  escrowReleasedAt?: string | Date;
  paymentExpiresAt?: string | Date;
  refundId?: string;
  refundedAt?: string | Date;
  refundAmount?: number;
  cancelReason?: string;
  cancelledAt?: string | Date;
  confirmedAt?: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export enum EventBookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}
