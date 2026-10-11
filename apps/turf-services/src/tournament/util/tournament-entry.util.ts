import { BadRequestException } from '@nestjs/common';
import {
  TournamentFormat,
  tournamentSizeError,
} from '../tournament.constants';

export function assertTournamentSize(
  format: TournamentFormat,
  maxTeams: number,
): void {
  const message = tournamentSizeError(format, maxTeams);
  if (message) {
    throw new BadRequestException(message);
  }
}

export function assertTournamentSizeIfSet(
  format: TournamentFormat,
  maxTeams?: number | null,
): void {
  if (maxTeams == null) {
    return;
  }
  assertTournamentSize(format, maxTeams);
}

export function isTournamentRosterLocked(tournament: {
  rosterLockedAt?: Date | null;
}): boolean {
  return tournament.rosterLockedAt != null;
}

export function requireTournamentMaxTeams(tournament: {
  maxTeams?: number | null;
}): number {
  if (tournament.maxTeams == null) {
    throw new BadRequestException('Tournament team capacity is not set');
  }
  return tournament.maxTeams;
}
