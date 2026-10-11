import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import {
  TeamMatchDocument,
  TeamMatchStatus,
} from '../../matchmaking/schemas/team-match.schema';
import {
  assertMatchHasBothTeams,
  ensureMatchHasTeam,
} from '../../matchmaking/util/matchmaking.helpers';
import { requireSideId } from '../../core/utils/mongo-ref.util';
import { TERMINAL_ALL_STATUSES } from '../../matchmaking/util/matchmaking.constants';
import { SportType } from '../../team/schemas/team.schema';

/** Match rows must reach schedule-finalized or ongoing before scorekeeping. */
const SCORING_ALLOWED_MATCH_STATUSES: TeamMatchStatus[] = [
  TeamMatchStatus.SCHEDULE_FINALIZED,
  TeamMatchStatus.ONGOING,
  TeamMatchStatus.ACCEPTED,
];

export async function requireTeamMatchForScoring(
  teamMatchModel: Model<TeamMatchDocument>,
  teamMatchId: string,
): Promise<TeamMatchDocument> {
  const match = await teamMatchModel.findById(teamMatchId);
  if (!match) {
    throw new NotFoundException('Team match not found');
  }
  return match;
}

export function assertTeamMatchSport(
  match: TeamMatchDocument,
  expected: SportType,
): void {
  if (match.sportType !== expected) {
    throw new BadRequestException(
      `Team match sport is ${match.sportType}, expected ${expected}`,
    );
  }
}

export function assertTeamsAlignWithMatch(
  match: TeamMatchDocument,
  teamOneId: Types.ObjectId,
  teamTwoId: Types.ObjectId,
): void {
  assertMatchHasBothTeams(match);
  const a = teamOneId.toString();
  const b = teamTwoId.toString();
  const from = requireSideId(match.fromTeam);
  const to = requireSideId(match.toTeam);
  const pairMatches = (a === from && b === to) || (a === to && b === from);
  if (!pairMatches) {
    throw new BadRequestException(
      'teamOneId and teamTwoId must be the two teams on the team match',
    );
  }
}

export function ensureActorTeamOnMatch(
  match: TeamMatchDocument,
  actorTeamId: Types.ObjectId,
): void {
  ensureMatchHasTeam(match, actorTeamId);
}

/** Scorekeeping uses `TeamMatch.status`: terminal → closed; otherwise must be finalized or ongoing. */
export function assertCanAppendScoringEvents(match: TeamMatchDocument): void {
  assertMatchHasBothTeams(match);
  if (TERMINAL_ALL_STATUSES.includes(match.status)) {
    throw new BadRequestException('Scoring is closed for this match');
  }
  if (!SCORING_ALLOWED_MATCH_STATUSES.includes(match.status)) {
    throw new BadRequestException(
      'Match must be schedule-finalized or ongoing to record scoring',
    );
  }
}

/** First ball/event while still `schedule_finalized` marks the fixture as in play. */
export function bumpMatchStatusToOngoingIfScheduled(
  match: TeamMatchDocument,
): void {
  if (match.status === TeamMatchStatus.SCHEDULE_FINALIZED) {
    match.status = TeamMatchStatus.ONGOING;
  }
}
