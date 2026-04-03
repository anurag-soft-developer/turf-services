import { Types } from 'mongoose';
import type { GeoPoint } from '../../core/schemas/geo-location.schema';

export interface ILocation {
  address: string;
  coordinates: GeoPoint;
}

export interface IDimensions {
  length?: number;
  width?: number;
  unit: string;
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
  slotBufferMins: number;
  averageRating?: number;
  totalReviews?: number;
  createdAt: string;
  updatedAt: string;
}
