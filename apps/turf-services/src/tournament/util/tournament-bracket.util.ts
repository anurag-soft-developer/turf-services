import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { resolveId, resolveIdOrNull } from '../../core/utils/mongo-ref.util';
import { TeamMatchDocument, TeamMatchStatus } from '../../matchmaking/schemas/team-match.schema';
import { TournamentDocument } from '../schemas/tournament.schema';
import {
  TournamentFormat,
  TournamentStage,
} from '../tournament.constants';

export function advancingTeamId(match: TeamMatchDocument): string | null {
  if (match.tournamentBracketWinner) {
    return resolveId(match.tournamentBracketWinner);
  }
  if (match.status === TeamMatchStatus.COMPLETED && match.winnerTeam) {
    return resolveId(match.winnerTeam);
  }
  return null;
}

export function isUnstartedFixture(match: TeamMatchDocument): boolean {
  return match.status === TeamMatchStatus.SCHEDULE_FINALIZED;
}

/** A knockout draw that already contains every slot, including later TBD matches. */
export function knockoutSkeletonReady(
  tournament: TournamentDocument,
  matches: TeamMatchDocument[],
): boolean {
  if (tournament.format !== TournamentFormat.KNOCKOUT) {
    return false;
  }
  const maxTeams = tournament.maxTeams;
  if (maxTeams == null) {
    return false;
  }
  const knockout = matches.filter(
    (match) => match.stage === TournamentStage.KNOCKOUT,
  );
  if (knockout.length < maxTeams - 1) {
    return false;
  }
  return knockout.some((match) => (match.sourceMatchNumbers?.length ?? 0) > 0);
}

export type FixtureSide = 'fromTeam' | 'toTeam';

export function matchesFedBy(
  ancestorMatchNumber: number,
  matches: TeamMatchDocument[],
): Array<{ match: TeamMatchDocument; side: FixtureSide }> {
  const byNumber = indexByMatchNumber(matches);
  const fed: Array<{ match: TeamMatchDocument; side: FixtureSide }> = [];
  for (const match of matches) {
    const side = feederSide(match, ancestorMatchNumber, byNumber);
    if (side) {
      fed.push({ match, side });
    }
  }
  return fed;
}

export function indexByMatchNumber(
  matches: TeamMatchDocument[],
): Map<number, TeamMatchDocument> {
  const byNumber = new Map<number, TeamMatchDocument>();
  for (const match of matches) {
    if (match.matchNumber != null) {
      byNumber.set(match.matchNumber, match);
    }
  }
  return byNumber;
}

export function sortedSources(match: TeamMatchDocument): number[] {
  return [...(match.sourceMatchNumbers ?? [])].sort(
    (left, right) => left - right,
  );
}

export function advancingFrom(match?: TeamMatchDocument): string | null {
  if (!match) {
    return null;
  }
  return advancingTeamId(match);
}

function feederSide(
  match: TeamMatchDocument,
  ancestorMatchNumber: number,
  byNumber: Map<number, TeamMatchDocument>,
): FixtureSide | null {
  const sources = sortedSources(match);
  for (let index = 0; index < sources.length; index += 1) {
    if (feedsFrom(sources[index], ancestorMatchNumber, byNumber)) {
      return index === 0 ? 'fromTeam' : 'toTeam';
    }
  }
  return null;
}

function feedsFrom(
  matchNumber: number,
  ancestor: number,
  byNumber: Map<number, TeamMatchDocument>,
): boolean {
  if (matchNumber === ancestor) {
    return true;
  }
  const match = byNumber.get(matchNumber);
  if (!match) {
    return false;
  }
  return (match.sourceMatchNumbers ?? []).some((source) =>
    feedsFrom(source, ancestor, byNumber),
  );
}

export const ROUND_SLOT_FREE = new Set<TeamMatchStatus>([
  TeamMatchStatus.CANCELLED,
  TeamMatchStatus.ABANDONED,
  TeamMatchStatus.REJECTED,
  TeamMatchStatus.EXPIRED,
]);

export function assertFeederSideStillOpen(
  nextTeamId: string | null | undefined,
  sourceMatchNumber: number | undefined,
  side: FixtureSide,
  match: TeamMatchDocument,
  byNumber: Map<number, TeamMatchDocument>,
): void {
  if (nextTeamId === undefined || sourceMatchNumber == null) {
    return;
  }
  const parent = byNumber.get(sourceMatchNumber);
  if (!parent || !advancingTeamId(parent)) {
    return;
  }
  if (nextTeamId === resolveIdOrNull(match[side])) {
    return;
  }
  throw new BadRequestException(
    'This side is filled by the winner of an earlier match',
  );
}

export function assignFixtureSide(
  match: TeamMatchDocument,
  side: FixtureSide,
  teamId: string | null,
): void {
  if (teamId) {
    match[side] = new Types.ObjectId(teamId);
    return;
  }
  match.set(side, undefined);
}
