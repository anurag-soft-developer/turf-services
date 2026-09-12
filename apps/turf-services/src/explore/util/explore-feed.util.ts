import { createHash } from 'crypto';
import { TeamMatchStatus } from '../../matchmaking/schemas/team-match.schema';
import type { ExploreQueryDto } from '../dto/explore.dto';

export type ExploreFeedSession = {
  ids: string[];
  totalDocuments: number;
};

/** ~5 km buckets so GPS jitter does not bust the feed session cache. */
const GEO_BUCKET_DEG = 0.05;

export function exploreFiltersHash(query: ExploreQueryDto): string {
  const payload = [
    query.sportType ?? '',
    query.matchStatus ?? '',
    query.matchScope ?? '',
    query.lookingForMembers === undefined ? '' : String(query.lookingForMembers),
    query.teamOpenForMatch === undefined ? '' : String(query.teamOpenForMatch),
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
    if (!Array.isArray(parsed.ids) || typeof parsed.totalDocuments !== 'number') {
      return null;
    }
    return {
      ids: parsed.ids.map(String).filter(Boolean),
      totalDocuments: parsed.totalDocuments,
    };
  } catch {
    return null;
  }
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
