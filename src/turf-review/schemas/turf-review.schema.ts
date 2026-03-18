import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ITurfReview } from '../interfaces/turf-review.interface';
import { User } from '../../users/schemas/user.schema';
import { Turf } from '../../turf/schemas/turf.schema';

export type TurfReviewDocument = Omit<
  ITurfReview,
  '_id' | 'createdAt' | 'updatedAt' | 'moderatedAt' | 'visitDate'
> & {
  createdAt: Date;
  updatedAt: Date;
  moderatedAt?: Date;
  visitDate?: Date;
} & Document;

@Schema({
  timestamps: true,
})
export class TurfReview extends Document implements TurfReviewDocument {
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
  reviewedBy!: string;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: 5,
  })
  rating!: number;

  @Prop({
    type: String,
    trim: true,
    maxlength: 100,
  })
  title?: string;

  @Prop({
    type: String,
    trim: true,
    maxlength: 1000,
  })
  comment?: string;

  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: function (images: string[]) {
        return images.length <= 5; // Maximum 5 images per review
      },
      message: 'Maximum 5 images allowed per review',
    },
  })
  images?: string[];

  @Prop({
    type: Date,
  })
  visitDate?: Date;

  @Prop({
    type: Boolean,
    default: false,
  })
  isVerifiedBooking!: boolean;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  helpfulVotes!: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  notHelpfulVotes!: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  reportedCount!: number;

  @Prop({
    type: Boolean,
    default: false,
  })
  isModerated!: boolean;

  @Prop({
    type: Date,
  })
  moderatedAt?: Date;

  @Prop({
    type: String,
    ref: User.name,
  })
  moderatedBy?: string;

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

export const TurfReviewSchema = SchemaFactory.createForClass(TurfReview);

// Compound index to prevent duplicate reviews from same user for same turf
TurfReviewSchema.index({ turf: 1, reviewedBy: 1 }, { unique: true });

// Index for turf reviews with rating filtering
TurfReviewSchema.index({ turf: 1, rating: 1, createdAt: -1 });

// Index for user reviews
TurfReviewSchema.index({ reviewedBy: 1, createdAt: -1 });

// Index for moderation
TurfReviewSchema.index({ isModerated: 1, reportedCount: -1 });
