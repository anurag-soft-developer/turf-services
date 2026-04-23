import { Types } from 'mongoose';
export interface ITimeSlot {
  startTime: Date;
  endTime: Date;
}

/** One-hour (or configurable) bookable window for a calendar day listing. */
export interface ITurfTimeSlotListing {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  price: number;
  isBooked: boolean;
}

export interface ITurfBooking {
  _id: string;
  turf: Types.ObjectId; // Turf ID
  bookedBy: Types.ObjectId; // User ID
  timeSlots: ITimeSlot[]; // Multiple time slots support
  playerCount?: number;
  totalAmount: number;
  status: TurfBookingStatus;
  paymentStatus: PaymentStatus;
  paymentId?: string;
  razorpayOrderId?: string;
  invoiceId?: string;
  paidAt?: string | Date;
  paymentExpiresAt?: string | Date;
  slotHoldStatus?: SlotHoldStatus;
  refundId?: string;
  refundedAt?: string | Date;
  refundAmount?: number;
  notes?: string;
  cancelReason?: string;
  cancelledAt?: string | Date;
  confirmedAt?: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export enum TurfBookingStatus {
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

export enum SlotHoldStatus {
  ACTIVE = 'active',
  RELEASED = 'released',
}
