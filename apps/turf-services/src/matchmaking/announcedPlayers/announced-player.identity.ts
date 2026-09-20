import { AnnouncedPlayer } from './announced-players.schema';
import { resolveId } from '../../core/utils/mongo-ref.util';

export function announcedUserId(player: AnnouncedPlayer): string | undefined {
  return player.userId ? resolveId(player.userId) : undefined;
}

export function announcedGuestId(player: AnnouncedPlayer): string | undefined {
  return player.guestId ? resolveId(player.guestId) : undefined;
}

/** Scoring / lineup id: registered `userId`, otherwise walk-in `guestId`. */
export function announcedScoringId(player: AnnouncedPlayer): string | undefined {
  return announcedUserId(player) ?? announcedGuestId(player);
}


export function findAnnouncedPlayingPlayer(
  match: { announcedPlayers?: AnnouncedPlayer[] },
  teamId: string,
  scoringId: string,
): AnnouncedPlayer | undefined {
  return (match.announcedPlayers ?? []).find(
    (p) =>
      resolveId(p.teamId) === teamId &&
      !p.is_substitute &&
      announcedScoringId(p) === scoringId,
  );
}

export function findAnnouncedSquadPlayer(
  match: { announcedPlayers?: AnnouncedPlayer[] },
  teamId: string,
  scoringId: string,
): AnnouncedPlayer | undefined {
  return (match.announcedPlayers ?? []).find(
    (p) =>
      resolveId(p.teamId) === teamId && announcedScoringId(p) === scoringId,
  );
}
