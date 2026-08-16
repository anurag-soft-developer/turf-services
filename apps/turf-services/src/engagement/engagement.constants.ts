export const ENGAGEMENT_ENTITY_TYPES = [
  'post',
  'match',
  'team',
  'player',
] as const;

export type EngagementEntityType = (typeof ENGAGEMENT_ENTITY_TYPES)[number];

export const ENGAGEMENT_EVENT_KINDS = [
  'impression',
  'view',
  'watch',
] as const;

export type EngagementEventKind = (typeof ENGAGEMENT_EVENT_KINDS)[number];

export const ENGAGEMENT_DEDUPE_TTL_SECONDS = 6 * 60 * 60;
export const EXPLORE_FEED_SESSION_TTL_SECONDS = 120;
export const USER_LOCATION_THROTTLE_TTL_SECONDS = 900;
export const FOLLOW_IDS_CACHE_TTL_SECONDS = 60;

export function statsRedisKey(
  entityType: EngagementEntityType,
  entityId: string,
): string {
  return `stats:${entityType}:${entityId}`;
}

export function engageDedupeKey(
  userId: string,
  entityType: EngagementEntityType,
  entityId: string,
  kind: string,
): string {
  return `engage:dedupe:${userId}:${entityType}:${entityId}:${kind}`;
}

export function exploreFeedSessionKey(
  userId: string,
  category: string,
  filtersHash: string,
  geoBucket: string,
): string {
  return `explore:feed:${userId}:${category}:${filtersHash}:${geoBucket}`;
}

export function userLocThrottleKey(userId: string): string {
  return `user:loc:${userId}`;
}

export function followIdsCacheKey(
  userId: string,
  recipientType: string,
): string {
  return `follow:ids:${userId}:${recipientType}`;
}
