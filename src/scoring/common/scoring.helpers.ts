import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { ensureMatchHasTeam } from '../../matchmaking/util/matchmaking.helpers';
import { SportType } from '../../team/schemas/team.schema';

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
  const a = teamOneId.toString();
  const b = teamTwoId.toString();
  const from = match.fromTeam.toString();
  const to = match.toTeam.toString();
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
