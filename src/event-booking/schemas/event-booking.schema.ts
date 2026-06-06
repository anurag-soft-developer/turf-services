import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import {
  IEventBooking,
  EventBookingStatus,
  PaymentStatus,
} from '../interfaces/event-booking.interface';
import { User } from '../../users/schemas/user.schema';
import { Event } from '../../events/schemas/event.schema';

export type EventBookingDocument = Omit<
  IEventBooking,
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
export class EventBooking extends Document implements EventBookingDocument {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: Event.name,
  })
  event!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: User.name,
  })
  bookedBy!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  fullName!: string;

  @Prop({ type: String, required: true, trim: true })
  contactNumber!: string;

  @Prop({ type: String, maxlength: 500 })
  notes?: string;

  @Prop({ type: Number, min: 1 })
  playerCount?: number;

  @Prop({ type: Number, required: true, min: 0 })
  totalAmount!: number;

  @Prop({
    type: String,
    enum: Object.values(EventBookingStatus),
    default: EventBookingStatus.PENDING,
  })
  status!: EventBookingStatus;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.PENDING,
  })
  paymentStatus!: PaymentStatus;

  @Prop({ type: String })
  paymentId?: string;

  @Prop({ type: String })
  razorpayOrderId?: string;

  @Prop({ type: Number, min: 0 })
  platformFeeAmount?: number;

  @Prop({ type: Number, min: 0 })
  organizerPayoutAmount?: number;

  @Prop({ type: String })
  invoiceId?: string;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: Date })
  escrowCreditedAt?: Date;

  @Prop({ type: Date })
  escrowReleasedAt?: Date;

  @Prop({ type: Date })
  paymentExpiresAt?: Date;

  @Prop({ type: String })
  refundId?: string;

  @Prop({ type: Date })
  refundedAt?: Date;

  @Prop({ type: Number, min: 0 })
  refundAmount?: number;

  @Prop({ type: String, maxlength: 200 })
  cancelReason?: string;

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt!: Date;
}

export const EventBookingSchema = SchemaFactory.createForClass(EventBooking);

EventBookingSchema.index({ event: 1, status: 1, createdAt: -1 });
EventBookingSchema.index({ bookedBy: 1, createdAt: -1 });
EventBookingSchema.index({ razorpayOrderId: 1 });
EventBookingSchema.index({ paymentId: 1 });
EventBookingSchema.index({
  event: 1,
  escrowCreditedAt: 1,
  escrowReleasedAt: 1,
});
