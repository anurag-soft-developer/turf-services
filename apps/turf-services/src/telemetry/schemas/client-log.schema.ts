import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type ClientLogDocument = HydratedDocument<ClientLog>;

@Schema({ collection: 'client_logs', timestamps: false })
export class ClientLog {
  @Prop({ type: String, required: true })
  appId!: string;

  @Prop({ type: String })
  platform?: string;

  @Prop({ type: String })
  appVersion?: string;

  @Prop({ type: String })
  installId?: string;

  @Prop({ type: String })
  sessionId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, default: null })
  userId!: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  kind!: string;

  @Prop({ type: String })
  name?: string;

  @Prop({ type: String })
  level?: string;

  @Prop({ type: Date, required: true })
  occurredAt!: Date;

  @Prop({ type: Number })
  durationMs?: number;

  @Prop({ type: Number, default: 1 })
  count!: number;

  @Prop({ type: String, required: true })
  clientEventId!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  payload!: Record<string, unknown>;
}

export const ClientLogSchema = SchemaFactory.createForClass(ClientLog);

ClientLogSchema.index({ appId: 1, kind: 1, occurredAt: -1 });
ClientLogSchema.index({ appId: 1, name: 1, occurredAt: -1 });
ClientLogSchema.index({ appId: 1, clientEventId: 1 }, { unique: true });
