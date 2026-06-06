import { Types } from 'mongoose';
import type { GeoPoint } from '../../core/schemas/geo-location.schema';
import { ILocation } from '../../turf/interfaces/turf.interface';


export interface IEvent {
  _id: string;
  createdBy: Types.ObjectId;
  title: string;
  slug: string;
  description: string;
  coverImages: string[];
  eventDate: Date;
  reportingTime?: string;
  location: ILocation;
  price: number;
  currency: string;
  maxParticipants: number;
  registeredCount: number;
  turf?: Types.ObjectId;
  status: EventStatus;
  isClosed: boolean;
  closedAt?: Date;
  registrationsPaused: boolean;
  archive: boolean;
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum EventStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  PUBLISHED = 'published',
  REJECTED = 'rejected',
  CLOSED = 'closed',
}
