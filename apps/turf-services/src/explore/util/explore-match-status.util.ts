import { TeamMatchStatus } from '../../matchmaking/schemas/team-match.schema';

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
