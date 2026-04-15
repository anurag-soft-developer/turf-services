import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { ChatScope } from '../../package';

export type ChatMessageDocument = ChatMessage & Document;

@Schema({
  timestamps: true,
  collection: 'chat-messages',
})
export class ChatMessage {
  @Prop({
    type: String,
    enum: ['team', 'match', 'player'],
    required: true,
    index: true,
  })
  scope!: ChatScope;

  @Prop({ type: String, required: true, index: true })
  scopeId!: string;

  @Prop({ type: String, required: true, index: true })
  senderUserId!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 4000 })
  body!: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  messageId!: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  idempotencyKey!: string;

  @Prop({ type: Date, required: true, index: true })
  messageCreatedAt!: Date;

  @Prop({ type: Date })
  deletedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

ChatMessageSchema.index({ scope: 1, scopeId: 1, messageCreatedAt: -1 });
