import { Types} from 'mongoose';
export interface ITimeSlot {
  startTime: Date;
  endTime: Date;
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
  notes?: string;
  cancelReason?: string;
  cancelledAt?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
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
