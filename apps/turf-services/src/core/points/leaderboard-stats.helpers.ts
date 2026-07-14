import type {
  CricketPlayerStats,
  FootballPlayerStats,
  PlayerSportEntry,
} from '../sports/sport-stats';

export type TeamLeaderboardStats = {
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
};

export type PlayerLeaderboardStats = {
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  winRate: number;
};

type PlayerStatsShape = Pick<
  FootballPlayerStats | CricketPlayerStats,
  'matchesPlayed' | 'matchesWon'
>;

function asPlayerStatsShape(stats: unknown): PlayerStatsShape {
  if (!stats || typeof stats !== 'object') {
    return { matchesPlayed: 0, matchesWon: 0 };
  }
  const s = stats as Record<string, unknown>;
  return {
    matchesPlayed: typeof s.matchesPlayed === 'number' ? s.matchesPlayed : 0,
    matchesWon: typeof s.matchesWon === 'number' ? s.matchesWon : 0,
  };
}

export function playerLeaderboardStatsFromEntry(
  entry: PlayerSportEntry | undefined | null,
): PlayerLeaderboardStats {
  if (!entry) {
    return {
      matchesPlayed: 0,
      matchesWon: 0,
      matchesLost: 0,
      winRate: 0,
    };
  }
  const { matchesPlayed, matchesWon } = asPlayerStatsShape(entry.stats);
  const matchesLost = Math.max(0, matchesPlayed - matchesWon);
  return {
    matchesPlayed,
    matchesWon,
    matchesLost,
    winRate: matchesPlayed > 0 ? matchesWon / matchesPlayed : 0,
  };
}

export function teamLeaderboardStatsFromTeam(team: {
  matchesPlayed?: number;
  wins?: number;
  losses?: number;
  draws?: number;
  winRate?: number;
}): TeamLeaderboardStats {
  return {
    matchesPlayed: team.matchesPlayed ?? 0,
    wins: team.wins ?? 0,
    losses: team.losses ?? 0,
    draws: team.draws ?? 0,
    winRate: team.winRate ?? 0,
  };
}
