import { Types } from 'mongoose';

export enum SupportQueryStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
}

export enum SupportReplyAuthorRole {
  USER = 'user',
  PLATFORM_ADMIN = 'platform_admin',
}

export interface ISupportReply {
  authorId: Types.ObjectId;
  authorRole: SupportReplyAuthorRole;
  body: string;
  createdAt: Date;
}

export interface ISupportInternalNote {
  authorId: Types.ObjectId;
  body: string;
  createdAt: Date;
}

export interface ISupportQuery {
  _id: string;
  userId: Types.ObjectId;
  email?: string;
  phone?: string;
  subject: string;
  message: string;
  status: SupportQueryStatus;
  replies: ISupportReply[];
  internalNotes: ISupportInternalNote[];
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
