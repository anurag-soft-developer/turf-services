import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema,Types } from 'mongoose';
import {
  ITurf,
  IDimensions,
  IPricing,
  IOperatingHours,
} from '../interfaces/turf.interface';
import { User } from '../../users/schemas/user.schema';
import {
  GeoLocation,
  GeoLocationSchema,
} from '../../core/schemas/geo-location.schema';

export type TurfDocument = Omit<
  ITurf,
  '_id' | 'createdAt' | 'updatedAt' | 'submittedAt' | 'reviewedAt'
> & {
  createdAt: Date;
  updatedAt: Date;
  submittedAt?: Date;
  reviewedAt?: Date;
} & Document;

export enum TurfStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  PUBLISHED = 'published',
  REJECTED = 'rejected',
}

export const turfSelectFields: string = '_id name location images pricing postedBy';

@Schema()
export class Dimensions implements IDimensions {
  @Prop()
  length?: number;

  @Prop()
  width?: number;

  @Prop({ enum: ['meters', 'feet'], default: 'meters' })
  unit!: 'meters' | 'feet';
}

@Schema()
export class Pricing implements IPricing {
  @Prop({ required: true })
  basePricePerHour!: number;

  @Prop({ default: 0 })
  weekendSurge!: number;
}

@Schema()
export class OperatingHours implements IOperatingHours {
  @Prop({ default: '06:00' })
  open!: string;

  @Prop({ default: '23:00' })
  close!: string;
}

@Schema({
  timestamps: true,
})
export class Turf extends Document implements TurfDocument {
  @Prop({
    type: String,
    required: true,
    trim: true,
  })
  name!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: User.name,
  })
  postedBy!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
  })
  description!: string;

  @Prop({
    type: GeoLocationSchema,
    required: true,
  })
  location!: GeoLocation;

  @Prop({
    type: [String],
    default: [],
  })
  images!: string[];

  @Prop({
    type: [String],
    default: [],
  })
  amenities!: string[];

  @Prop({
    type: Dimensions,
    default: () => ({}),
  })
  dimensions!: Dimensions;

  @Prop({
    type: [String],
    required: true,
  })
  sportType!: string[];

  @Prop({
    type: Pricing,
    required: true,
  })
  pricing!: Pricing;

  @Prop({
    type: OperatingHours,
    default: () => ({}),
  })
  operatingHours!: OperatingHours;

  @Prop({
    type: Boolean,
    default: true,
  })
  isAvailable!: boolean;

  @Prop({
    type: String,
    enum: Object.values(TurfStatus),
    default: TurfStatus.DRAFT,
    index: true,
  })
  status!: TurfStatus;

  @Prop({ type: String })
  rejectionReason?: string;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
  })
  reviewedBy?: Types.ObjectId;

  @Prop({
    type: Number,
    default: 15,
  })
  slotBufferMins!: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  })
  averageRating!: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  totalReviews!: number;

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

export const TurfSchema = SchemaFactory.createForClass(Turf);

// Index for location-based searches
TurfSchema.index({ 'location.coordinates': '2dsphere' });
TurfSchema.index({ status: 1, isAvailable: 1, createdAt: -1 });
