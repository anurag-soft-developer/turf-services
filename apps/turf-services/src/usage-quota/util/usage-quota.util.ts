import { USAGE_QUOTA_TIME_ZONE } from '../usage-quota.constants';

const QUOTA_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export function usageDayKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: USAGE_QUOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function quotaExpiresAt(dayKey: string): Date {
  return new Date(
    new Date(`${dayKey}T00:00:00+05:30`).getTime() + QUOTA_RETENTION_MS,
  );
}

export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  );
}
