import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { IAppMetadata } from '../interfaces/app-metadata.interface';

export type AppMetadataDocument = Omit<
  IAppMetadata,
  '_id' | 'createdAt' | 'updatedAt'
> &
  Document;

@Schema({
  timestamps: true,
})
export class AppMetadata extends Document implements AppMetadataDocument {
  @Prop({
    type: [String],
    required: true,
    default: [],
  })
  sports!: string[];
}

export const AppMetadataSchema = SchemaFactory.createForClass(AppMetadata);

// Ensure only one metadata document exists
AppMetadataSchema.index({}, { unique: true });
