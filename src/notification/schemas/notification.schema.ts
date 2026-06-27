import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import type { NotificationData } from '../types/notification-data.types';

export type NotificationDocument = Notification & Document;

export enum NotificationModule {
  TURF_BOOKING = 'turfBooking',
  MATCHMAKING = 'matchmaking',
  EVENT_BOOKING = 'eventBooking',
  TEAMS = 'teams',
  CONNECTIONS = 'connections',
  WITHDRAWALS = 'withdrawals',
  TURF_APPROVAL = 'turfApproval',
}

@Schema({
  timestamps: true,
  collection: 'notifications',
})
export class Notification {
  @Prop({ type: String, required: true, index: true })
  recipientUserId!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    index: true,
    enum: Object.values(NotificationModule),
  })
  module!: NotificationModule;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 2000 })
  body!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  data?: NotificationData;

  @Prop({ type: String, trim: true, index: true })
  sourceType?: string;

  @Prop({ type: String, trim: true })
  sourceId?: string;

  @Prop({ type: Date })
  readAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ recipientUserId: 1, createdAt: -1 });
NotificationSchema.index({ recipientUserId: 1, readAt: 1, createdAt: -1 });
