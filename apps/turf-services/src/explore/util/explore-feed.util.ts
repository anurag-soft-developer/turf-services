import { createHash } from 'crypto';
import { TeamMatchStatus } from '../../matchmaking/schemas/team-match.schema';
import type { ExploreQueryDto } from '../dto/explore.dto';
import type { ExploreFeedItemType } from '../types/explore.types';

export type ExploreFeedRef = {
  type: ExploreFeedItemType;
  id: string;
};

export type ExploreFeedSession = {
  refs: ExploreFeedRef[];
  totalDocuments: number;
};

const FEED_REF_TYPES = new Set<ExploreFeedItemType>([
  'match',
  'team',
  'player',
  'post',
  'opening',
]);

/** ~5 km buckets so GPS jitter does not bust the feed session cache. */
const GEO_BUCKET_DEG = 0.05;

export function exploreFiltersHash(query: ExploreQueryDto): string {
  const payload = [
    query.sportType ?? '',
    query.matchStatus ?? '',
    query.matchScope ?? '',
    query.postKind ?? 'all',
    'weave4',
  ].join('|');
  return createHash('sha1').update(payload).digest('hex').slice(0, 12);
}

export function exploreGeoBucket(query: ExploreQueryDto): string {
  const lat = query.location?.nearbyLat;
  const lng = query.location?.nearbyLng;
  if (lat === undefined || lng === undefined) return 'noloc';
  const bLat = Math.round(lat / GEO_BUCKET_DEG) * GEO_BUCKET_DEG;
  const bLng = Math.round(lng / GEO_BUCKET_DEG) * GEO_BUCKET_DEG;
  return `${bLat.toFixed(2)}_${bLng.toFixed(2)}`;
}

export function parseExploreFeedSession(
  raw: string | null,
): ExploreFeedSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ExploreFeedSession;
    if (!Array.isArray(parsed.refs) || typeof parsed.totalDocuments !== 'number') {
      return null;
    }
    const refs: ExploreFeedRef[] = [];
    for (const ref of parsed.refs) {
      if (!isExploreFeedRef(ref)) return null;
      refs.push(ref);
    }
    return {
      refs,
      totalDocuments: parsed.totalDocuments,
    };
  } catch {
    return null;
  }
}

/**
 * Place openings among posts. One opening after every `every` posts.
 * A short post list uses a gap of 1 so openings are not all deferred.
 * Feed windows leave extra openings for the next window. Search keeps them.
 */
export function weaveOpenings<T>(
  posts: T[],
  openings: T[],
  options?: { every?: number; keepRemainder?: boolean },
): T[] {
  const every = options?.every ?? 4;
  if (!posts.length) return openings;
  if (!openings.length) return posts;

  const interval = options?.keepRemainder
    ? Math.max(1, Math.floor(posts.length / openings.length) || 1)
    : posts.length < every
      ? 1
      : every;

  const out: T[] = [];
  let placed = 0;
  for (let i = 0; i < posts.length; i++) {
    out.push(posts[i]);
    if ((i + 1) % interval === 0 && placed < openings.length) {
      out.push(openings[placed]);
      placed += 1;
    }
  }
  if (options?.keepRemainder && placed < openings.length) {
    out.push(...openings.slice(placed));
  }
  return out;
}

function isExploreFeedRef(value: unknown): value is ExploreFeedRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as ExploreFeedRef;
  return FEED_REF_TYPES.has(ref.type) && typeof ref.id === 'string' && ref.id.length > 0;
}

/** Default browseable match statuses (mirrors Flutter MatchListFilters). */
export const DEFAULT_EXPLORE_MATCH_STATUSES: TeamMatchStatus[] = [
  TeamMatchStatus.SCHEDULE_FINALIZED,
  TeamMatchStatus.ONGOING,
  TeamMatchStatus.COMPLETED,
  TeamMatchStatus.DRAW,
];

export function resolveExploreMatchStatuses(
  matchStatus: 'all' | 'live' | 'upcoming' | 'completed',
): TeamMatchStatus[] {
  switch (matchStatus) {
    case 'live':
      return [TeamMatchStatus.ONGOING];
    case 'upcoming':
      return [TeamMatchStatus.SCHEDULE_FINALIZED];
    case 'completed':
      return [TeamMatchStatus.COMPLETED, TeamMatchStatus.DRAW];
    case 'all':
    default:
      return DEFAULT_EXPLORE_MATCH_STATUSES;
  }
}

/** Plain JSON-safe object so engagement fields survive Nest serialization. */
export function toPlainExploreData(data: unknown): Record<string, unknown> {
  if (
    data != null &&
    typeof data === 'object' &&
    typeof (data as { toObject?: unknown }).toObject === 'function'
  ) {
    return (data as { toObject: () => Record<string, unknown> }).toObject();
  }
  if (data != null && typeof data === 'object') {
    return { ...(data as Record<string, unknown>) };
  }
  return {};
}
