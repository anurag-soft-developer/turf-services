import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type DailyUsageQuotaDocument = DailyUsageQuota & Document;

@Schema({
  timestamps: true,
  collection: 'daily_usage_quotas',
})
export class DailyUsageQuota {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
  })
  userId!: Types.ObjectId;

  /** `YYYY-MM-DD` in Asia/Kolkata. */
  @Prop({ type: String, required: true })
  dayKey!: string;

  @Prop({ type: Number, default: 0, min: 0 })
  postsCreated!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  uploadsCount!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  uploadBytes!: number;

  /** Mongo TTL. Quota rows are only needed for the current day. */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const DailyUsageQuotaSchema =
  SchemaFactory.createForClass(DailyUsageQuota);

DailyUsageQuotaSchema.index({ userId: 1, dayKey: 1 }, { unique: true });
DailyUsageQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
