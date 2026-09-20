import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { resolveId } from '../../core/utils/mongo-ref.util';
import {
  findAnnouncedPlayingPlayer,
  findAnnouncedSquadPlayer,
} from '../../matchmaking/announcedPlayers/announced-player.identity';

/** Registered userId or walk-in guestId in the playing (non-substitute) XI. */
export function assertAnnouncedPlayingParticipant(
  match: TeamMatchDocument,
  teamId: Types.ObjectId,
  scoringId: Types.ObjectId,
  label: string,
): void {
  const ok = findAnnouncedPlayingPlayer(
    match,
    resolveId(teamId),
    scoringId.toString(),
  );
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
