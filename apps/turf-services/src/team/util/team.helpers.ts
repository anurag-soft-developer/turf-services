import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { TeamMemberService } from '../../team-member/team-member.service';
import {
  assertCanActForTeam,
  buildPreMatchInboxStatusClause,
} from '../../matchmaking/util/matchmaking.helpers';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { TeamDocument, TeamVisibility } from '../schemas/team.schema';
import { TeamService } from '../team.service';

/** Case-insensitive match on common team text fields. */
export function buildTeamTextSearchClause(
  search: string,
): Record<string, unknown> {
  const trimmed = search.trim();
  if (!trimmed) {
    return {};
  }
  const searchRegex = new RegExp(trimmed, 'i');
  return {
    $or: [
      { name: searchRegex },
      { shortName: searchRegex },
      { tagline: searchRegex },
      { description: searchRegex },
      { 'location.address': searchRegex },
    ],
  };
}

export async function assertCanViewTeam(
  team: TeamDocument,
  viewerId: string,
  teamMemberService: TeamMemberService,
  isOwner: (team: TeamDocument, userId: string) => boolean,
): Promise<void> {
  if (team.visibility === TeamVisibility.PUBLIC) {
    return;
  }
  if (isOwner(team, viewerId)) {
    return;
  }
  if (
    await teamMemberService.hasActiveMembership(team._id.toString(), viewerId)
  ) {
    return;
  }
  throw new ForbiddenException('You cannot view this private team');
}

/** Opponent team ids that already have an active outbound request from [fromTeamId]. */
export async function distinctOpponentsWithSentRequest(
  userId: string,
  fromTeamId: string,
  teamMatchModel: Model<TeamMatchDocument>,
  teamService: TeamService,
  teamMemberService: TeamMemberService,
  requireTeam: (id: string) => Promise<TeamDocument>,
): Promise<Types.ObjectId[]> {
  let fromTeamOid: Types.ObjectId;
  try {
    fromTeamOid = new Types.ObjectId(fromTeamId);
  } catch {
    throw new BadRequestException('Invalid fromTeamId');
  }

  const fromTeam = await requireTeam(fromTeamId);
  await assertCanActForTeam(fromTeam, userId, teamService, teamMemberService);

  return teamMatchModel.distinct('toTeam', {
    fromTeam: fromTeamOid,
    ...buildPreMatchInboxStatusClause(),
  });
}
