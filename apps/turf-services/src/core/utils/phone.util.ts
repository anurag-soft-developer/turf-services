import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normalize a phone to E.164. Requires an explicit country calling code
 * (leading `+`); national-only numbers are rejected.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith('+')) {
    throw new BadRequestException(
      'Phone must include country code, e.g. +919876543210',
    );
  }
  const parsed = parsePhoneNumberFromString(trimmed);
  if (!parsed || !parsed.isValid()) {
    throw new BadRequestException('Invalid phone number');
  }
  return parsed.format('E.164');
}
