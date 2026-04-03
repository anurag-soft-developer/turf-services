import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type ConnectionDocument = Connection & Document;

export enum ConnectionStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

@Schema({
  timestamps: true,
  collection: 'connections',
})
export class Connection {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  requester!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  recipient!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ConnectionStatus),
    default: ConnectionStatus.PENDING,
  })
  status!: ConnectionStatus;

  /** When set (rejected only), MongoDB TTL deletes the document at this instant. */
  @Prop({ type: Date })
  purgeAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConnectionSchema = SchemaFactory.createForClass(Connection);

ConnectionSchema.index(
  { requester: 1, recipient: 1 },
  { unique: true },
);

ConnectionSchema.index(
  { purgeAt: 1 },
  { expireAfterSeconds: 0 },
);

ConnectionSchema.index({ requester: 1, status: 1 });
ConnectionSchema.index({ recipient: 1, status: 1 });
