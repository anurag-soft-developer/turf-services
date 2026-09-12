import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { ChatScope } from '../../../../../libs';

export type ChatMessageReactionDocument = ChatMessageReaction & Document;

@Schema({
  timestamps: true,
  collection: 'chat-message-reactions',
})
export class ChatMessageReaction {
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
  messageId!: string;

  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true })
  emoji!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ChatMessageReactionSchema =
  SchemaFactory.createForClass(ChatMessageReaction);

ChatMessageReactionSchema.index(
  { messageId: 1, userId: 1, emoji: 1 },
  { unique: true },
);
ChatMessageReactionSchema.index({ messageId: 1 });
