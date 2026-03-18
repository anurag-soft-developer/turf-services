import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  ITurfBooking,
  TurfBookingStatus,
  PaymentStatus,
} from '../interfaces/turf-booking.interface';
import { User } from '../../users/schemas/user.schema';
import { Turf } from '../../turf/schemas/turf.schema';

export type TurfBookingDocument = Omit<
  ITurfBooking,
  '_id' | 'cancelledAt' | 'confirmedAt' | 'createdAt' | 'updatedAt'
> &
  Document & {
    cancelledAt?: Date;
    confirmedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
  };

@Schema({
  timestamps: true,
})
export class TurfBooking extends Document implements TurfBookingDocument {
  @Prop({
    type: String,
    required: true,
    ref: Turf.name,
  })
  turf!: string;

  @Prop({
    type: String,
    required: true,
    ref: User.name,
  })
  bookedBy!: string;

  @Prop({
    type: Date,
    required: true,
  })
  startTime!: Date;

  @Prop({
    type: Date,
    required: true,
  })
  endTime!: Date;

  @Prop({
    type: Number,
    min: 1,
  })
  playerCount?: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
  })
  totalAmount!: number;

  @Prop({
    type: String,
    enum: Object.values(TurfBookingStatus),
    default: TurfBookingStatus.PENDING,
  })
  status!: TurfBookingStatus;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.PENDING,
  })
  paymentStatus!: PaymentStatus;

  @Prop({
    type: String,
  })
  paymentId?: string;

  @Prop({
    type: String,
    maxlength: 500,
  })
  notes?: string;

  @Prop({
    type: String,
    maxlength: 200,
  })
  cancelReason?: string;

  @Prop({
    type: Date,
  })
  cancelledAt?: Date;

  @Prop({
    type: Date,
  })
  confirmedAt?: Date;

  @Prop({
    type: Date,
    default: Date.now,
  })
  createdAt!: Date;

  @Prop({
    type: Date,
    default: Date.now,
  })
  updatedAt!: Date;


}

export const TurfBookingSchema = SchemaFactory.createForClass(TurfBooking);

// Compound index to efficiently check for time overlaps
TurfBookingSchema.index({
  turf: 1,
  startTime: 1,
  endTime: 1,
  status: 1,
});

// Index for user bookings
TurfBookingSchema.index({ bookedBy: 1, createdAt: -1 });

// Index for turf owner to see their turf bookings
TurfBookingSchema.index({ turf: 1, createdAt: -1 });

// // Pre-save validation to ensure endTime is after startTime
// TurfBookingSchema.pre('save', function (next,) {
//   if (this.startTime >= this.endTime) {
//     const error = new Error('End time must be after start time');
//     return next(error);
//   }

//   // Ensure booking is not in the past (with 5min buffer)
//   const now = new Date();
//   const bufferTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes buffer

//   if (this.startTime < bufferTime) {
//     const error = new Error('Cannot book a slot in the past');
//     return next(error);
//   }

//   next();
// });
