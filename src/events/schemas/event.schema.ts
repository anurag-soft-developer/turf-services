import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { IEvent, EventStatus } from '../interfaces/event.interface';
import { User } from '../../users/schemas/user.schema';
import { Turf } from '../../turf/schemas/turf.schema';
import {
  GeoLocation,
  GeoLocationSchema,
} from '../../core/schemas/geo-location.schema';

export type EventDocument = Omit<
  IEvent,
  '_id' | 'createdAt' | 'updatedAt' | 'submittedAt' | 'reviewedAt' | 'closedAt'
> & {
  createdAt: Date;
  updatedAt: Date;
  submittedAt?: Date;
  reviewedAt?: Date;
  closedAt?: Date;
} & Document;

export const eventSelectFields =
  '_id title slug description coverImages eventDate reportingTime location price currency maxParticipants registeredCount status isClosed registrationsPaused createdBy';

@Schema({
  timestamps: true,
})
export class Event extends Document implements EventDocument {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: User.name,
    index: true,
  })
  createdBy!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  title!: string;

  @Prop({ type: String, required: true, trim: true, unique: true, index: true })
  slug!: string;

  @Prop({ type: String, required: true })
  description!: string;

  @Prop({ type: [String], default: [] })
  coverImages!: string[];

  @Prop({ type: Date, required: true, index: true })
  eventDate!: Date;

  @Prop({ type: String, trim: true })
  reportingTime?: string;

  @Prop({ type: GeoLocationSchema, required: true })
  location!: GeoLocation;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  price!: number;

  @Prop({ type: String, default: 'INR', trim: true })
  currency!: string;

  @Prop({ type: Number, required: true, min: 1 })
  maxParticipants!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  registeredCount!: number;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Turf.name,
  })
  turf?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(EventStatus),
    default: EventStatus.DRAFT,
    index: true,
  })
  status!: EventStatus;

  @Prop({ type: Boolean, default: false })
  isClosed!: boolean;

  @Prop({ type: Date })
  closedAt?: Date;

  @Prop({ type: Boolean, default: false })
  registrationsPaused!: boolean;

  @Prop({ type: Boolean, default: false })
  archive!: boolean;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
  })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: String, maxlength: 2000 })
  rejectionReason?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt!: Date;
}

export const EventSchema = SchemaFactory.createForClass(Event);

EventSchema.index({ status: 1, eventDate: 1 });
EventSchema.index({ createdBy: 1, createdAt: -1 });
EventSchema.index({ 'location.coordinates': '2dsphere' });
