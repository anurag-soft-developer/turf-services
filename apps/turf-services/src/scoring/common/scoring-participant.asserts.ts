import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { resolveId } from '../../core/utils/mongo-ref.util';
import {
  findAnnouncedPlayingPlayer,
  findAnnouncedSquadPlayer,
} from '../../matchmaking/announcedPlayers/announced-player.identity';
import {
  activeIdsForTeam,
  type ActiveLineupState,
} from './lineup.helpers';

/** Registered userId or walk-in guestId in the live active lineup (falls back to XI). */
export function assertAnnouncedPlayingParticipant(
  match: TeamMatchDocument,
  teamId: Types.ObjectId,
  scoringId: Types.ObjectId,
  label: string,
): void {
  const teamIdStr = resolveId(teamId);
  const scoringIdStr = scoringId.toString();

  const state = (match.cricketState ?? match.footballState) as
    | ActiveLineupState
    | undefined
    | null;

  if (state) {
    const inSquad = findAnnouncedSquadPlayer(match, teamIdStr, scoringIdStr);
    if (!inSquad) {
      throw new BadRequestException(
        `${label} is not in the announced squad for that team`,
      );
    }
    const active = activeIdsForTeam(match, teamId, state);
    if (!active.some((id) => resolveId(id) === scoringIdStr)) {
      throw new BadRequestException(
        `${label} is not in the active lineup for that team`,
      );
    }
    return;
  }

  const ok = findAnnouncedPlayingPlayer(match, teamIdStr, scoringIdStr);
  if (!ok) {
    throw new BadRequestException(
      `${label} is not in the announced playing XI for that team`,
    );
  }
}

/** Registered userId or guestId anywhere on the announced squad (includes substitutes). */
export function assertAnnouncedSquadParticipant(
  match: TeamMatchDocument,
  teamId: Types.ObjectId,
  scoringId: Types.ObjectId,
  label: string,
): void {
  const ok = findAnnouncedSquadPlayer(
    match,
    resolveId(teamId),
    scoringId.toString(),
  );
  if (!ok) {
    throw new BadRequestException(
      `${label} is not in the announced squad for that team`,
    );
  }
}
