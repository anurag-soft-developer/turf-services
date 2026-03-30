import { Types } from 'mongoose';

export interface ITurfReview {
  _id: string;
  turf: Types.ObjectId; // Turf ID
  reviewedBy: Types.ObjectId; // User ID
  rating: number; // 1-5 stars
  title?: string;
  comment?: string;
  images?: string[]; // Array of image URLs
  visitDate?: string;
  isVerifiedBooking?: boolean;
  helpfulVotes: number;
  notHelpfulVotes: number;
  reportedCount: number;
  isModerated: boolean;
  moderatedAt?: string;
  moderatedBy?: Types.ObjectId;
  createdAt?: string;
  updatedAt?: string;
}
