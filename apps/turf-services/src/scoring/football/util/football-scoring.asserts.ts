import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { assertCanActForTeam } from '../../../matchmaking/util/matchmaking.helpers';
import { TeamMatchDocument } from '../../../matchmaking/schemas/team-match.schema';
import { TeamService } from '../../../team/team.service';
import { TeamMemberService } from '../../../team-member/team-member.service';

export async function assertUserOnTeam(
  teamMemberService: TeamMemberService,
  userId: Types.ObjectId,
  teamId: Types.ObjectId,
): Promise<void> {
  const ok = await teamMemberService.hasActiveMembership(
    teamId.toString(),
    userId.toString(),
  );
  if (!ok) {
    throw new BadRequestException(
      `User ${userId.toString()} is not an active member of team ${teamId.toString()}`,
    );
  }
}

export async function assertLeadershipOnMatchTeams(
  teamService: TeamService,
  teamMemberService: TeamMemberService,
  userId: string,
  match: TeamMatchDocument,
): Promise<void> {
  const t1 = await teamService.requireTeam(match.fromTeam.toString());
  const t2 = await teamService.requireTeam(match.toTeam.toString());
  const can1 = await canLeadershipAct(
    teamService,
    teamMemberService,
    t1,
    userId,
  );
  const can2 = await canLeadershipAct(
    teamService,
    teamMemberService,
    t2,
    userId,
  );
  if (!can1 && !can2) {
    throw new ForbiddenException(
      'Only owners, captains, or vice captains of a match team can score',
    );
  }
}

async function canLeadershipAct(
  teamService: TeamService,
  teamMemberService: TeamMemberService,
  team: Awaited<ReturnType<TeamService['requireTeam']>>,
  userId: string,
): Promise<boolean> {
  try {
    await assertCanActForTeam(team, userId, teamService, teamMemberService);
    return true;
  } catch {
    return false;
  }
}
