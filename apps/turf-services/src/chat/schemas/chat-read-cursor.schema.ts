import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { ChatScope } from '../../../../../libs';

export type ChatReadCursorDocument = ChatReadCursor & Document;

@Schema({
  timestamps: true,
  collection: 'chat-read-cursors',
})
export class ChatReadCursor {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({
    type: String,
    enum: ['team', 'match', 'player'],
    required: true,
    index: true,
  })
  scope!: ChatScope;

  @Prop({ type: String, required: true, index: true })
  scopeId!: string;

  @Prop({ type: Date, required: true })
  lastReadAt!: Date;

  /** When set, inbox hides this room until a newer message arrives. */
  @Prop({ type: Date })
  hiddenAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ChatReadCursorSchema =
  SchemaFactory.createForClass(ChatReadCursor);

ChatReadCursorSchema.index(
  { userId: 1, scope: 1, scopeId: 1 },
  { unique: true },
);
