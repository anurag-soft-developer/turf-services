import { BadRequestException } from '@nestjs/common';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { SportType, SPORT_ROSTER_CONFIG } from '../../team/schemas/team.schema';

const SPORT_SCORING_LABEL: Record<SportType, string> = {
  [SportType.CRICKET]: 'cricket',
  [SportType.FOOTBALL]: 'football',
};

/**
 * Minimum playing (non-substitute) announced players per team when starting live scoring.
 * Keys match [SPORT_ROSTER_CONFIG] min roster sizes.
 */
export const SCORING_MIN_ANNOUNCED_PLAYERS: Record<SportType, number> = {
  [SportType.CRICKET]: SPORT_ROSTER_CONFIG[SportType.CRICKET].min,
  [SportType.FOOTBALL]: SPORT_ROSTER_CONFIG[SportType.FOOTBALL].min,
};

export function assertAnnouncedSquadsForSport(
  match: TeamMatchDocument,
  sportType: SportType,
): void {
  const players = match.announcedPlayers ?? [];
  const sportLabel = SPORT_SCORING_LABEL[sportType];
  const minPlayers = SCORING_MIN_ANNOUNCED_PLAYERS[sportType];

  if (players.length === 0) {
    throw new BadRequestException(
      `Announced playing squads are required before starting ${sportLabel} scoring`,
    );
  }

  const t1 = match.fromTeam.toString();
  const t2 = match.toTeam.toString();

  for (const p of players) {
    const tid = p.teamId.toString();
    if (tid !== t1 && tid !== t2) {
      throw new BadRequestException(
        'Each announced player teamId must be one of the two teams on this match',
      );
    }
  }

  const playing = players.filter((p) => !p.is_substitute);
  const countFor = (tid: string) =>
    playing.filter((p) => p.teamId.toString() === tid).length;

  const n1 = countFor(t1);
  const n2 = countFor(t2);
  if (n1 < minPlayers || n2 < minPlayers) {
    throw new BadRequestException(
      `Each team must have at least ${minPlayers} playing (non-substitute) announced players (fromTeam: ${n1}, toTeam: ${n2})`,
    );
  }

  const allIds = players.map((p) => p.userId.toString());
  if (new Set(allIds).size !== allIds.length) {
    throw new BadRequestException(
      'Duplicate userId in announced players (includes the same player on both teams)',
    );
  }
}
