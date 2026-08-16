import { TeamMatchStatus } from '../../matchmaking/schemas/team-match.schema';
import type { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';
import type { PublicProfile } from '../../users/interfaces/user.interface';
import type { ContentPostDocument } from '../../post/schemas/content-post.schema';
import {
  coordinatesLngLat,
  haversineKm,
} from '../../core/utils/geo-near-page.util';
import type { EntityStats } from '../../engagement/engagement.service';
import type { ScoredExploreItem } from '../types/explore.types';
import { resolveId } from '../../core/utils/mongo-ref.util';

export type RankingOrigin = { lat: number; lng: number };

export type RankingContext = {
  userId: string;
  mode: 'feed' | 'search';
  query?: string;
  origin?: RankingOrigin;
  followedUserIds: Set<string>;
  followedTeamIds: Set<string>;
  viewerSports: Set<string>;
  querySport?: string;
  stats: Map<string, EntityStats>;
};

const EMPTY_STATS: EntityStats = {
  impressions: 0,
  views: 0,
  watchMs: 0,
  likeCount: 0,
};

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function dailyNoise(userId: string, itemId: string): number {
  const day = new Date().toISOString().slice(0, 10);
  return (hashSeed(`${userId}:${day}:${itemId}`) % 1000) / 1000 * 0.01;
}

function textRelevance(text: string | undefined, query: string): number {
  if (!text || !query) return 0;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) return 0;
  if (lowerText === lowerQuery) return 200;
  if (lowerText.startsWith(lowerQuery)) return 120;
  if (lowerText.includes(lowerQuery)) return 60;
  return 0;
}

function recencyDecay(ageHours: number): number {
  return Math.exp(-ageHours / 36);
}

function ageHoursFrom(date?: Date | string): number {
  if (!date) return 24 * 30;
  const ts = new Date(date).getTime();
  if (Number.isNaN(ts)) return 24 * 30;
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
}

function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total <= 0 || successes <= 0) return 0;
  const phat = Math.min(1, successes / total);
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denom);
}

function logNorm(value: number, cap: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log(1 + value) / Math.log(1 + cap));
}

function engagementScore(stats: EntityStats): number {
  const ctr = wilsonLowerBound(stats.views, stats.impressions);
  const views = logNorm(stats.views, 1000);
  const watch = Math.min(1, stats.watchMs / 120_000);
  const likes = logNorm(stats.likeCount, 100);
  return 0.4 * ctr + 0.3 * views + 0.2 * watch + 0.1 * likes;
}

function proximityScore(km: number | undefined): number {
  if (km == null || !Number.isFinite(km)) return 0;
  return 1 / (1 + km / 10);
}

function typePrior(item: ScoredExploreItem): number {
  switch (item.type) {
    case 'match': {
      const status = (item.data as TeamMatchDocument).status;
      if (status === TeamMatchStatus.ONGOING) return 1.0;
      if (status === TeamMatchStatus.SCHEDULE_FINALIZED) return 0.8;
      if (
        status === TeamMatchStatus.COMPLETED ||
        status === TeamMatchStatus.DRAW
      ) {
        return 0.45;
      }
      return 0.4;
    }
    case 'post':
      return 0.85;
    case 'team':
      return 0.55;
    case 'player':
      return 0.4;
  }
}

function entityId(item: ScoredExploreItem): string {
  const data = item.data as { _id?: unknown };
  return data._id != null ? String(data._id) : '';
}

function statsKey(item: ScoredExploreItem): string {
  return `${item.type}:${entityId(item)}`;
}

function createdAtOf(item: ScoredExploreItem): Date | string | undefined {
  return (item.data as { createdAt?: Date | string }).createdAt;
}

function updatedAtOf(item: ScoredExploreItem): Date | string | undefined {
  return (item.data as { updatedAt?: Date | string }).updatedAt;
}

function teamFieldFromRef(
  team: unknown,
  field: 'name' | 'shortName' | 'tagline' | 'sportType' | '_id',
): string | undefined {
  if (!team || typeof team !== 'object' || !(field in team)) {
    return undefined;
  }
  const value = (team as Record<string, unknown>)[field];
  if (value == null) return undefined;
  return String(value);
}

function postSport(post: ContentPostDocument): string | undefined {
  const teamSport = teamFieldFromRef(post.team, 'sportType');
  if (teamSport) return teamSport;
  const match = post.match as unknown as { sportType?: string } | undefined;
  return match && typeof match === 'object' ? match.sportType : undefined;
}

function sportMatchScore(item: ScoredExploreItem, ctx: RankingContext): number {
  const wanted = new Set(ctx.viewerSports);
  if (ctx.querySport) wanted.add(ctx.querySport);
  if (wanted.size === 0) return 0;

  switch (item.type) {
    case 'match': {
      const sport = (item.data as TeamMatchDocument).sportType;
      return sport && wanted.has(String(sport)) ? 1 : 0;
    }
    case 'team': {
      const sport = (item.data as TeamDocument).sportType;
      return sport && wanted.has(String(sport)) ? 1 : 0;
    }
    case 'player': {
      const stats = (item.data as PublicProfile).playerSportStats ?? [];
      return stats.some((s) => wanted.has(String(s.sportType))) ? 1 : 0;
    }
    case 'post': {
      const sport = postSport(item.data as ContentPostDocument);
      return sport && wanted.has(sport) ? 1 : 0;
    }
  }
}

function socialScore(item: ScoredExploreItem, ctx: RankingContext): number {
  switch (item.type) {
    case 'match': {
      const match = item.data as TeamMatchDocument;
      const fromId = resolveId(match.fromTeam);
      const toId = resolveId(match.toTeam);
      return ctx.followedTeamIds.has(fromId) || ctx.followedTeamIds.has(toId)
        ? 1
        : 0;
    }
    case 'team': {
      const id = String((item.data as TeamDocument)._id ?? '');
      return ctx.followedTeamIds.has(id) ? 1 : 0;
    }
    case 'player': {
      const id = String((item.data as PublicProfile)._id ?? '');
      return ctx.followedUserIds.has(id) ? 1 : 0;
    }
    case 'post': {
      const post = item.data as ContentPostDocument;
      const author = resolveId(post.postedBy);
      const teamId = post.team ? resolveId(post.team) : '';
      if (ctx.followedUserIds.has(author)) return 1;
      if (teamId && ctx.followedTeamIds.has(teamId)) return 1;
      return 0;
    }
  }
}

function distanceKm(item: ScoredExploreItem, origin?: RankingOrigin): number | undefined {
  if (!origin) return undefined;
  let lngLat: [number, number] | undefined;
  switch (item.type) {
    case 'match':
      lngLat = coordinatesLngLat(
        (item.data as TeamMatchDocument).venueLocation?.coordinates,
      );
      break;
    case 'team':
      lngLat = coordinatesLngLat(
        (item.data as TeamDocument).location?.coordinates,
      );
      break;
    case 'player':
      lngLat = coordinatesLngLat((item.data as PublicProfile).lastLocation);
      break;
    case 'post':
      lngLat = coordinatesLngLat(
        (item.data as ContentPostDocument).location?.coordinates,
      );
      break;
  }
  if (!lngLat) return undefined;
  return haversineKm(origin.lat, origin.lng, lngLat[1], lngLat[0]);
}

function searchTextScore(item: ScoredExploreItem, query: string): number {
  switch (item.type) {
    case 'match': {
      const match = item.data as TeamMatchDocument;
      return Math.max(
        textRelevance(teamFieldFromRef(match.fromTeam, 'name'), query),
        textRelevance(teamFieldFromRef(match.fromTeam, 'shortName'), query),
        textRelevance(teamFieldFromRef(match.toTeam, 'name'), query),
        textRelevance(teamFieldFromRef(match.toTeam, 'shortName'), query),
      );
    }
    case 'team': {
      const team = item.data as TeamDocument;
      return Math.max(
        textRelevance(team.name, query),
        textRelevance(team.shortName, query),
        textRelevance(team.tagline, query),
      );
    }
    case 'player':
      return textRelevance((item.data as PublicProfile).fullName, query);
    case 'post': {
      const post = item.data as ContentPostDocument;
      const tagText = post.tags?.join(' ');
      return Math.max(
        textRelevance(post.title, query),
        textRelevance(post.content, query),
        textRelevance(tagText, query),
      );
    }
  }
}

function qualityScore(item: ScoredExploreItem, ctx: RankingContext): number {
  const stats = ctx.stats.get(statsKey(item)) ?? EMPTY_STATS;
  const recency = recencyDecay(ageHoursFrom(updatedAtOf(item) ?? createdAtOf(item)));
  const engagement = engagementScore(stats);
  const social = socialScore(item, ctx);
  const sport = sportMatchScore(item, ctx);

  let proximityOrText: number;
  if (ctx.mode === 'search') {
    proximityOrText = Math.min(1, searchTextScore(item, ctx.query ?? '') / 200);
  } else {
    proximityOrText = proximityScore(distanceKm(item, ctx.origin));
  }

  let quality =
    0.25 * recency +
    0.25 * engagement +
    0.3 * proximityOrText +
    0.15 * social +
    0.05 * sport;

  if (item.type === 'post' && ageHoursFrom(createdAtOf(item)) < 24) {
    quality += 0.05;
  }

  return Math.min(1.2, quality);
}

export function rankExploreItems(
  items: ScoredExploreItem[],
  ctx: RankingContext,
): ScoredExploreItem[] {
  const scored = items.map((item) => {
    const quality = qualityScore(item, ctx);
    const prior = typePrior(item);
    const score = prior * quality + dailyNoise(ctx.userId, entityId(item));
    return { ...item, score };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export function toScoredExploreItems(
  type: 'match' | 'team' | 'player' | 'post',
  data:
    | TeamMatchDocument[]
    | TeamDocument[]
    | PublicProfile[]
    | ContentPostDocument[],
): ScoredExploreItem[] {
  return data.map((item) => ({
    type,
    data: item as never,
    score: 0,
  }));
}
