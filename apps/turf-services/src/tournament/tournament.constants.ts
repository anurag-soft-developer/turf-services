export enum TournamentFormat {
  KNOCKOUT = 'knockout',
  LEAGUE = 'league',
  HYBRID = 'hybrid',
}

export enum TournamentStatus {
  DRAFT = 'draft',
  INVITING = 'inviting',
  SCHEDULED = 'scheduled',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum TournamentStage {
  GROUP = 'group',
  KNOCKOUT = 'knockout',
  LEAGUE = 'league',
}

/** Legacy group-stage hybrid (existing draws). */
export const HYBRID_GROUP_SIZE = 4;
export const HYBRID_ADVANCE_COUNT = 2;
export const LEAGUE_WIN_POINTS = 2;

export const TOURNAMENT_MIN_LEAGUE_TEAMS = 3;
export const TOURNAMENT_MIN_HYBRID_TEAMS = 4;
export const TOURNAMENT_MIN_KNOCKOUT_TEAMS = 4;

/** Manual qualifier picks for single-table hybrid league phase. */
export const HYBRID_LEAGUE_QUALIFIER_LABEL = '';

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Largest power-of-two knockout bracket (≥4) that fits [maxTeams]. */
export function hybridKnockoutBracketSize(maxTeams: number): number {
  if (maxTeams < TOURNAMENT_MIN_KNOCKOUT_TEAMS) {
    return TOURNAMENT_MIN_KNOCKOUT_TEAMS;
  }
  let size = TOURNAMENT_MIN_KNOCKOUT_TEAMS;
  while (size * 2 <= maxTeams) {
    size *= 2;
  }
  return size;
}

export function tournamentSizeError(
  format: TournamentFormat,
  maxTeams: number,
): string | null {
  if (!Number.isInteger(maxTeams) || maxTeams < 1) {
    return 'Team count must be a positive whole number';
  }
  if (format === TournamentFormat.KNOCKOUT) {
    if (maxTeams < TOURNAMENT_MIN_KNOCKOUT_TEAMS) {
      return `Knockout tournaments need at least ${TOURNAMENT_MIN_KNOCKOUT_TEAMS} teams`;
    }
    if (!isPowerOfTwo(maxTeams)) {
      return 'Knockout team count must be a power of two (4, 8, 16, 32, 64, …)';
    }
    return null;
  }
  if (format === TournamentFormat.LEAGUE) {
    if (maxTeams < TOURNAMENT_MIN_LEAGUE_TEAMS) {
      return `League tournaments need at least ${TOURNAMENT_MIN_LEAGUE_TEAMS} teams`;
    }
    return null;
  }
  if (format === TournamentFormat.HYBRID) {
    if (maxTeams < TOURNAMENT_MIN_HYBRID_TEAMS) {
      return `Hybrid tournaments need at least ${TOURNAMENT_MIN_HYBRID_TEAMS} teams`;
    }
    return null;
  }
  return null;
}

/** Knockout round number of the match that decides the tournament. */
export function knockoutFinalRound(
  format: TournamentFormat,
  maxTeams: number,
  knockoutBracketSize?: number,
): number | null {
  if (format === TournamentFormat.LEAGUE) {
    return null;
  }
  if (format === TournamentFormat.KNOCKOUT) {
    return Math.log2(maxTeams);
  }
  const bracket =
    knockoutBracketSize ?? hybridKnockoutBracketSize(maxTeams);
  return Math.log2(bracket);
}
