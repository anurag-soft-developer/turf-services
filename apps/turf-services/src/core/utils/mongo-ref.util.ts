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
export function resolveId(ref: MongoRefLike | null | undefined): string {
  if (ref == null) {
    throw new BadRequestException('Invalid document reference');
  }
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

/** Missing knockout sides stay empty instead of throwing. */
export function resolveIdOrNull(
  ref: MongoRefLike | null | undefined,
): string | null {
  if (ref == null) {
    return null;
  }
  try {
    const id = resolveId(ref).trim();
    return id.length ? id : null;
  } catch {
    return null;
  }
}

export function requireSideId(ref: MongoRefLike | null | undefined): string {
  const id = resolveIdOrNull(ref);
  if (!id) {
    throw new BadRequestException(
      'Both teams must be set before this match can be played',
    );
  }
  return id;
}
