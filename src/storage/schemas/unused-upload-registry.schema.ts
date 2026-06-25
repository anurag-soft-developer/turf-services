import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { MediaUploadPurpose } from '../../post/dto/media-upload.dto';

export type UnusedUploadRegistryDocument = UnusedUploadRegistry & Document;

export enum UnusedUploadStatus {
  PENDING = 'pending',
  ATTACHED = 'attached',
}

@Schema({
  timestamps: true,
  collection: 'unused_upload_registry',
})
export class UnusedUploadRegistry {
  @Prop({ type: String, required: true, unique: true, index: true })
  objectKey!: string;

  @Prop({ type: String, required: true, trim: true })
  fileUrl!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  uploadedBy!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(MediaUploadPurpose),
    required: true,
  })
  purpose!: MediaUploadPurpose;

  @Prop({
    type: String,
    enum: Object.values(UnusedUploadStatus),
    required: true,
    default: UnusedUploadStatus.PENDING,
    index: true,
  })
  status!: UnusedUploadStatus;

  @Prop({ type: String, trim: true })
  entityType?: string;

  @Prop({ type: String, trim: true })
  entityId?: string;

  @Prop({ type: Date, required: true, index: true })
  expiresAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UnusedUploadRegistrySchema =
  SchemaFactory.createForClass(UnusedUploadRegistry);

UnusedUploadRegistrySchema.index({ status: 1, expiresAt: 1 });
