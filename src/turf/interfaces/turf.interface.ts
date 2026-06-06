import { Types } from 'mongoose';
import type { GeoPoint } from '../../core/schemas/geo-location.schema';
import { TurfStatus } from '../schemas/turf.schema';

export interface ILocation {
  address: string;
  coordinates: GeoPoint;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface IDimensions {
  length?: number;
  width?: number;
  unit?: 'meters' | 'feet';
}

export interface IPricing {
  basePricePerHour: number;
  weekendSurge: number;
}

export interface IOperatingHours {
  open: string;
  close: string;
}

export interface ITurf {
  _id: string;
  postedBy: Types.ObjectId;
  name: string;
  description: string;
  location: ILocation;
  images: string[];
  amenities: string[];
  dimensions: IDimensions;
  sportType: string[];
  pricing: IPricing;
  operatingHours: IOperatingHours;
  isAvailable: boolean;
  status: TurfStatus;
  rejectionReason?: string;
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
  slotBufferMins: number;
  averageRating?: number;
  totalReviews?: number;
  createdAt: string;
  updatedAt: string;
}
