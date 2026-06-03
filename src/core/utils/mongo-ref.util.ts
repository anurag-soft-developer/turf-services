import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/** Mongoose ObjectId ref or populated subdocument with `_id`. */
export type MongoRefLike =
  | Types.ObjectId
  | { _id?: Types.ObjectId | string }
  | string;

/**
 * Normalizes a Mongoose ref or populated document to a hex ObjectId string.
 */
export function resolveId(ref: MongoRefLike): string {
  if (ref instanceof Types.ObjectId) {
    return ref.toString();
  }
  if (typeof ref === 'string') {
    return ref;
  }
  if (ref?._id instanceof Types.ObjectId) {
    return ref._id.toString();
  }
  if (ref?._id != null) {
    return String(ref._id);
  }
  throw new BadRequestException('Invalid document reference');
}
