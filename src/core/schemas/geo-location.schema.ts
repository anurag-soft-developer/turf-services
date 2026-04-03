import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

export type GeoPoint = { type: 'Point'; coordinates: [number, number] };

export const GeoPointSchema = new MongooseSchema(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  },
  { _id: false },
);

@Schema({ _id: false })
export class GeoLocation {
  @Prop({ required: true, trim: true })
  address!: string;

  @Prop({ type: GeoPointSchema, required: true })
  coordinates!: GeoPoint;
}

export const GeoLocationSchema = SchemaFactory.createForClass(GeoLocation);
