import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import {
  ITurfBooking,
  ITimeSlot,
  TurfBookingStatus,
  PaymentStatus,
  SlotHoldStatus,
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

@Schema()
export class TimeSlot implements ITimeSlot {
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
}

@Schema({
  timestamps: true,
})
export class TurfBooking extends Document implements TurfBookingDocument {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: Turf.name,
  })
  turf!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: User.name,
  })
  bookedBy!: Types.ObjectId;

  @Prop({
    type: [TimeSlot],
    required: true,
    validate: {
      validator: function (slots: ITimeSlot[]) {
        return slots && slots.length > 0;
      },
      message: 'At least one time slot is required',
    },
  })
  timeSlots!: ITimeSlot[];

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
  })
  razorpayOrderId?: string;

  @Prop({
    type: String,
  })
  invoiceId?: string;

  @Prop({
    type: Date,
  })
  paidAt?: Date;

  @Prop({
    type: Date,
  })
  paymentExpiresAt?: Date;

  @Prop({
    type: String,
    enum: Object.values(SlotHoldStatus),
    default: SlotHoldStatus.ACTIVE,
  })
  slotHoldStatus?: SlotHoldStatus;

  @Prop({
    type: String,
  })
  refundId?: string;

  @Prop({
    type: Date,
  })
  refundedAt?: Date;

  @Prop({
    type: Number,
    min: 0,
  })
  refundAmount?: number;

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

// Compound index for efficient queries by turf and status
TurfBookingSchema.index({
  turf: 1,
  status: 1,
  createdAt: -1,
});

// Index for user bookings
TurfBookingSchema.index({ bookedBy: 1, createdAt: -1 });

// Index for turf owner to see their turf bookings
TurfBookingSchema.index({ turf: 1, createdAt: -1 });

// Index for resolving bookings from payment webhooks
TurfBookingSchema.index({ razorpayOrderId: 1 });
TurfBookingSchema.index({ paymentId: 1 });

// Index on timeSlots for efficient overlap detection
TurfBookingSchema.index({
  turf: 1,
  'timeSlots.startTime': 1,
  'timeSlots.endTime': 1,
  status: 1,
});

// Index for expiring pending slot holds
TurfBookingSchema.index({
  status: 1,
  slotHoldStatus: 1,
  paymentExpiresAt: 1,
});
