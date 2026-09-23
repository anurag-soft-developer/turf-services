import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  announcedScoringId,
  findAnnouncedSquadPlayer,
} from '../../matchmaking/announcedPlayers/announced-player.identity';
import { AnnouncedPlayer } from '../../matchmaking/announcedPlayers/announced-players.schema';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { resolveId } from '../../core/utils/mongo-ref.util';

export type ActiveLineupState = {
  fromTeamActiveParticipantIds?: Types.ObjectId[];
  toTeamActiveParticipantIds?: Types.ObjectId[];
};

/** Starting XI scoring ids for a team (`!is_substitute`). */
export function initialActiveParticipantIds(
  match: { announcedPlayers?: AnnouncedPlayer[]; fromTeam: Types.ObjectId; toTeam: Types.ObjectId },
  teamId: string,
): Types.ObjectId[] {
  return (match.announcedPlayers ?? [])
    .filter(
      (p) => resolveId(p.teamId) === teamId && !p.is_substitute,
    )
    .map((p) => {
      const id = announcedScoringId(p);
      return id ? new Types.ObjectId(id) : null;
    })
    .filter((id): id is Types.ObjectId => id != null);
}

/** Stored active ids, or starting XI when empty / missing. */
export function getActiveIds(
  match: { announcedPlayers?: AnnouncedPlayer[]; fromTeam: Types.ObjectId; toTeam: Types.ObjectId },
  teamId: string,
  stored: Types.ObjectId[] | undefined | null,
): Types.ObjectId[] {
  if (stored && stored.length > 0) {
    return stored.map((id) => new Types.ObjectId(resolveId(id)));
  }
  return initialActiveParticipantIds(match, teamId);
}

export function activeIdsForTeam(
  match: TeamMatchDocument,
  teamId: Types.ObjectId | string,
  state: ActiveLineupState,
): Types.ObjectId[] {
  const tid = resolveId(teamId);
  const fromId = resolveId(match.fromTeam);
  const stored =
    tid === fromId
      ? state.fromTeamActiveParticipantIds
      : state.toTeamActiveParticipantIds;
  return getActiveIds(match, tid, stored);
}

export function setActiveIdsForTeam(
  match: TeamMatchDocument,
  teamId: Types.ObjectId | string,
  state: ActiveLineupState,
  ids: Types.ObjectId[],
): void {
  const tid = resolveId(teamId);
  const fromId = resolveId(match.fromTeam);
  if (tid === fromId) {
    state.fromTeamActiveParticipantIds = ids;
  } else if (tid === resolveId(match.toTeam)) {
    state.toTeamActiveParticipantIds = ids;
  } else {
    throw new BadRequestException('Invalid team id for lineup');
  }
}

function bumpSubstitutionFlags(
  match: TeamMatchDocument,
  participantIds: string[],
  delta: 1 | -1,
): void {
  const wanted = new Set(participantIds);
  for (const p of match.announcedPlayers ?? []) {
    const sid = announcedScoringId(p);
    if (!sid || !wanted.has(sid)) continue;
    const next = Math.max(0, (p.substitute_count ?? 0) + delta);
    p.substitute_count = next;
    if (delta > 0) {
      p.is_substituted = true;
    } else if (next === 0) {
      p.is_substituted = false;
    }
  }
  match.markModified('announcedPlayers');
}

/**
 * Swap `playerOff` → `playerOn` in the team's active set and bump announced-player
 * substitution flags / counts.
 */
export function applySubstitution(
  match: TeamMatchDocument,
  state: ActiveLineupState,
  teamId: Types.ObjectId,
  playerOff: Types.ObjectId,
  playerOn: Types.ObjectId,
): void {
  const teamIdStr = resolveId(teamId);
  const offStr = resolveId(playerOff);
  const onStr = resolveId(playerOn);

  if (offStr === onStr) {
    throw new BadRequestException('Player off and player on must differ');
  }

  if (!findAnnouncedSquadPlayer(match, teamIdStr, onStr)) {
    throw new BadRequestException(
      'Player on is not in the announced squad for that team',
    );
  }
  if (!findAnnouncedSquadPlayer(match, teamIdStr, offStr)) {
    throw new BadRequestException(
      'Player off is not in the announced squad for that team',
    );
  }

  const active = activeIdsForTeam(match, teamId, state);
  const offIdx = active.findIndex((id) => resolveId(id) === offStr);
  if (offIdx < 0) {
    throw new BadRequestException('Player off is not in the active lineup');
  }
  if (active.some((id) => resolveId(id) === onStr)) {
    throw new BadRequestException('Player on is already in the active lineup');
  }

  active[offIdx] = new Types.ObjectId(onStr);
  setActiveIdsForTeam(match, teamId, state, active);
  bumpSubstitutionFlags(match, [offStr, onStr], 1);
}

/** Reverse a substitution (active swap + decrement counts). */
export function revertSubstitution(
  match: TeamMatchDocument,
  state: ActiveLineupState,
  teamId: Types.ObjectId,
  playerOff: Types.ObjectId,
  playerOn: Types.ObjectId,
): void {
  const teamIdStr = resolveId(teamId);
  const offStr = resolveId(playerOff);
  const onStr = resolveId(playerOn);

  const active = activeIdsForTeam(match, teamId, state);
  const onIdx = active.findIndex((id) => resolveId(id) === onStr);
  if (onIdx < 0) {
    throw new BadRequestException(
      'Cannot revert substitution: player on is not active',
    );
  }
  if (active.some((id) => resolveId(id) === offStr)) {
    throw new BadRequestException(
      'Cannot revert substitution: player off is already active',
    );
  }

  // Ensure both are still on the squad record (should be).
  if (
    !findAnnouncedSquadPlayer(match, teamIdStr, offStr) ||
    !findAnnouncedSquadPlayer(match, teamIdStr, onStr)
  ) {
    throw new BadRequestException('Cannot revert substitution: squad mismatch');
  }

  active[onIdx] = new Types.ObjectId(offStr);
  setActiveIdsForTeam(match, teamId, state, active);
  bumpSubstitutionFlags(match, [offStr, onStr], -1);
}

/** Remove a sent-off / unavailable player from the live active lineup. */
export function removeFromActiveLineup(
  match: TeamMatchDocument,
  state: ActiveLineupState,
  teamId: Types.ObjectId,
  participantId: Types.ObjectId,
): void {
  const idStr = resolveId(participantId);
  const active = activeIdsForTeam(match, teamId, state);
  const idx = active.findIndex((id) => resolveId(id) === idStr);
  if (idx < 0) {
    throw new BadRequestException('Player is not in the active lineup');
  }
  active.splice(idx, 1);
  setActiveIdsForTeam(match, teamId, state, active);
}

/** Re-add a player to the active lineup (e.g. undo red card). */
export function restoreToActiveLineup(
  match: TeamMatchDocument,
  state: ActiveLineupState,
  teamId: Types.ObjectId,
  participantId: Types.ObjectId,
): void {
  const teamIdStr = resolveId(teamId);
  const idStr = resolveId(participantId);

  if (!findAnnouncedSquadPlayer(match, teamIdStr, idStr)) {
    throw new BadRequestException(
      'Player is not in the announced squad for that team',
    );
  }

  const active = activeIdsForTeam(match, teamId, state);
  if (active.some((id) => resolveId(id) === idStr)) {
    return;
  }
  active.push(new Types.ObjectId(idStr));
  setActiveIdsForTeam(match, teamId, state, active);
}
