
export interface ITurfBooking {
  _id: string;
  turf: string; // Turf ID
  bookedBy: string; // User ID
  startTime: Date;
  endTime: Date;
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
