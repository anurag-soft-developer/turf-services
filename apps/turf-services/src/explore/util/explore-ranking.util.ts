import { TeamMatchStatus } from '../../matchmaking/schemas/team-match.schema';
import type { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';
import type { PublicProfile } from '../../users/interfaces/user.interface';
import type { ScoredExploreItem } from '../types/explore.types';

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function dailyShuffleOffset(userId: string, itemId: string): number {
  const day = new Date().toISOString().slice(0, 10);
  return hashSeed(`${userId}:${day}:${itemId}`) % 1000;
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

function matchRecencyScore(updatedAt?: Date | string): number {
  if (!updatedAt) return 0;
  const ts = new Date(updatedAt).getTime();
  if (Number.isNaN(ts)) return 0;
  const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
  return Math.max(0, 100 - ageHours);
}

function scoreMatchFeed(
  match: TeamMatchDocument,
  userId: string,
): number {
  const id = String(match._id ?? '');
  const shuffle = dailyShuffleOffset(userId, id);
  const recency = matchRecencyScore(match.updatedAt);

  switch (match.status) {
    case TeamMatchStatus.ONGOING:
      return 1000 + recency + shuffle * 0.001;
    case TeamMatchStatus.SCHEDULE_FINALIZED:
      return 800 + recency + shuffle * 0.001;
    case TeamMatchStatus.COMPLETED:
    case TeamMatchStatus.DRAW:
      return 400 + recency + shuffle * 0.001;
    default:
      return 200 + recency + shuffle * 0.001;
  }
}

function teamFieldFromRef(
  team: TeamMatchDocument['fromTeam'],
  field: 'name' | 'shortName',
): string | undefined {
  if (!team || typeof team !== 'object' || !(field in team)) {
    return undefined;
  }
  const value = (team as unknown as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function scoreMatchSearch(match: TeamMatchDocument, query: string): number {
  const relevance = Math.max(
    textRelevance(teamFieldFromRef(match.fromTeam, 'name'), query),
    textRelevance(teamFieldFromRef(match.fromTeam, 'shortName'), query),
    textRelevance(teamFieldFromRef(match.toTeam, 'name'), query),
    textRelevance(teamFieldFromRef(match.toTeam, 'shortName'), query),
  );
  return relevance + matchRecencyScore(match.updatedAt) + scoreMatchFeed(match, '');
}

function scoreTeamFeed(team: TeamDocument, userId: string): number {
  const id = String(team._id ?? '');
  const shuffle = dailyShuffleOffset(userId, id);
  let score = 600 + (team.rankingPoints ?? 0) * 0.1;
  if (team.teamOpenForMatch) score += 50;
  if (team.lookingForMembers) score += 30;
  return score + shuffle * 0.001;
}

function scoreTeamSearch(team: TeamDocument, query: string, userId: string): number {
  const relevance = Math.max(
    textRelevance(team.name, query),
    textRelevance(team.shortName, query),
    textRelevance(team.tagline, query),
  );
  return relevance + scoreTeamFeed(team, userId);
}

function scorePlayerFeed(player: PublicProfile, userId: string): number {
  const id = String(player._id ?? '');
  const shuffle = dailyShuffleOffset(userId, id);
  return 500 + (player.followerCount ?? 0) * 0.05 + shuffle * 0.001;
}

function scorePlayerSearch(
  player: PublicProfile,
  query: string,
  userId: string,
): number {
  const relevance = textRelevance(player.fullName, query);
  return relevance + scorePlayerFeed(player, userId);
}

export function rankExploreItems(params: {
  items: ScoredExploreItem[];
  mode: 'feed' | 'search';
  query?: string;
  userId: string;
}): ScoredExploreItem[] {
  const { items, mode, query, userId } = params;
  const scored = items.map((item) => {
    let score = item.score;
    if (mode === 'feed') {
      switch (item.type) {
        case 'match':
          score = scoreMatchFeed(item.data as TeamMatchDocument, userId);
          break;
        case 'team':
          score = scoreTeamFeed(item.data as TeamDocument, userId);
          break;
        case 'player':
          score = scorePlayerFeed(item.data as PublicProfile, userId);
          break;
      }
    } else {
      const q = query ?? '';
      switch (item.type) {
        case 'match':
          score = scoreMatchSearch(item.data as TeamMatchDocument, q);
          break;
        case 'team':
          score = scoreTeamSearch(item.data as TeamDocument, q, userId);
          break;
        case 'player':
          score = scorePlayerSearch(item.data as PublicProfile, q, userId);
          break;
      }
    }
    return { ...item, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

export function toScoredExploreItems(
  type: 'match' | 'team' | 'player',
  data: TeamMatchDocument[] | TeamDocument[] | PublicProfile[],
): ScoredExploreItem[] {
  return data.map((item) => ({
    type,
    data: item as never,
    score: 0,
  }));
}
