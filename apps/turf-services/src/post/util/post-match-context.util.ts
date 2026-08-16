import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  TeamMatchDocument,
  TeamMatchStatus,
} from '../../matchmaking/schemas/team-match.schema';
import { TeamMemberService } from '../../team-member/team-member.service';
import { TeamService } from '../../team/team.service';
import { resolveId } from '../../core/utils/mongo-ref.util';

const MATCH_PHOTO_ALLOWED_STATUSES: TeamMatchStatus[] = [
  TeamMatchStatus.SCHEDULE_FINALIZED,
  TeamMatchStatus.ONGOING,
  TeamMatchStatus.COMPLETED,
  TeamMatchStatus.DRAW,
];

export function assertMatchAllowsPhotoPosts(match: TeamMatchDocument): void {
  if (!MATCH_PHOTO_ALLOWED_STATUSES.includes(match.status)) {
    throw new BadRequestException(
      'Photos can only be attached after the match schedule is finalized',
    );
  }
}

export function resolveSelectedTurfId(
  match: TeamMatchDocument,
): Types.ObjectId {
  if (!match.selectedTurfProposalId) {
    throw new BadRequestException('Match has no selected turf');
  }
  const selected = match.proposedTurfs.find(
    (p) =>
      resolveId(p.proposalId) === resolveId(match.selectedTurfProposalId!),
  );
  if (!selected) {
    throw new BadRequestException('Match has no selected turf');
  }
  return new Types.ObjectId(resolveId(selected.turfId));
}

export async function assertUserCanPostForMatch(
  match: TeamMatchDocument,
  userId: string,
  teamService: TeamService,
  teamMemberService: TeamMemberService,
): Promise<void> {
  const fromId = resolveId(match.fromTeam);
  const toId = resolveId(match.toTeam);

  const activeTeamIds = await teamMemberService.distinctActiveTeamIds(userId);
  const activeSet = new Set(activeTeamIds.map((id) => resolveId(id)));
  if (activeSet.has(fromId) || activeSet.has(toId)) {
    return;
  }

  const [fromTeam, toTeam] = await Promise.all([
    teamService.requireTeam(fromId),
    teamService.requireTeam(toId),
  ]);
  if (
    teamService.isOwner(fromTeam, userId) ||
    teamService.isOwner(toTeam, userId)
  ) {
    return;
  }

  throw new ForbiddenException('User is not part of this match');
}
