/** One entry in a user's per-sport ranking points array. */
export interface SportRankingPointsEntry {
  sportType: string;
  points: number;
}

export type RankingPointsBreakdownEntry = {
  reason: string;
  points: number;
};

export type PlayerRankingPointsDelta = {
  userId: string;
  teamId: string;
  points: number;
  breakdown: RankingPointsBreakdownEntry[];
};

export type TeamRankingPointsDelta = {
  teamId: string;
  points: number;
  breakdown: RankingPointsBreakdownEntry[];
};

/** Stored on TeamMatch after ranking points are applied at match completion. */
export type MatchRankingPointsSnapshot = {
  players: PlayerRankingPointsDelta[];
  teams: TeamRankingPointsDelta[];
};

import type {
  PlayerLeaderboardStats,
  TeamLeaderboardStats,
} from './leaderboard-stats.helpers';

export type LeaderboardRow = {
  rank: number;
  id: string;
  name: string;
  points: number;
  avatar?: string;
};

export type TeamLeaderboardRow = LeaderboardRow & {
  stats: TeamLeaderboardStats;
};

export type PlayerLeaderboardRow = LeaderboardRow & {
  stats: PlayerLeaderboardStats;
};
