import { Types } from 'mongoose';

export enum TermsAndConditionsKind {
  TURF_OWNER = 'turf_owner',
  EVENT_BOOKING = 'event_booking',
  EVENT_HOST = 'event_host',
}

export enum TermsAndConditionsStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

export interface ITermsAndConditions {
  _id: string;
  kind: TermsAndConditionsKind;
  version: string;
  title: string;
  content: string;
  status: TermsAndConditionsStatus;
  createdBy: Types.ObjectId;
  publishedBy?: Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
