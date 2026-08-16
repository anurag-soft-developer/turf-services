import { createHash } from 'crypto';
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
