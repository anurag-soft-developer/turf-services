export interface ITurfReview {
  _id: string;
  turf: string; // Turf ID
  reviewedBy: string; // User ID
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
  moderatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}
