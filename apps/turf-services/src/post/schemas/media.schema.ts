import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type MediaDocument = Media & Document;

export enum MediaKind {
  IMAGE = 'image',
  VIDEO = 'video',
}

@Schema({
  timestamps: true,
  collection: 'media',
})
export class Media {
  @Prop({ type: String, required: true, trim: true, maxlength: 2048 })
  url!: string;

  @Prop({
    type: String,
    enum: Object.values(MediaKind),
    required: true,
  })
  kind!: MediaKind;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  uploadedBy!: Types.ObjectId;

  @Prop({ type: String, trim: true, maxlength: 500 })
  caption?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const MediaSchema = SchemaFactory.createForClass(Media);

MediaSchema.index({ uploadedBy: 1, createdAt: -1 });
