import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TeamMemberService } from '../../team-member/team-member.service';
import { TeamService } from '../../team/team.service';
import {
  MatchProposalStatus,
  TeamMatchDocument,
} from '../schemas/team-match.schema';

async function isUserAffiliatedWithMatchTeam(
  teamId: Types.ObjectId,
  userId: string,
  teamService: TeamService,
  teamMemberService: TeamMemberService,
): Promise<boolean> {
  const team = await teamService.requireTeam(teamId.toString());
  if (teamService.isOwner(team, userId)) {
    return true;
  }
  return teamMemberService.hasActiveMembership(teamId.toString(), userId);
}

/**
 * Team used for self-accept (proposer === decider). Defaults to the match team the
 * user belongs to (owner or active member); if they belong to both, they must pass
 * `selfAcceptTeamId`. If `selfAcceptTeamId` is set, the user must be affiliated with that team.
 */
export async function resolveSelfAcceptTeamId(
  match: TeamMatchDocument,
  selfAcceptTeamId: string | undefined,
  userId: string,
  teamService: TeamService,
  teamMemberService: TeamMemberService,
): Promise<Types.ObjectId> {
  if (selfAcceptTeamId) {
    const tid = new Types.ObjectId(selfAcceptTeamId);
    if (!tid.equals(match.fromTeam) && !tid.equals(match.toTeam)) {
      throw new BadRequestException(
        'selfAcceptTeamId must be the challenging or receiving team id',
      );
    }
    const ok = await isUserAffiliatedWithMatchTeam(
      tid,
      userId,
      teamService,
      teamMemberService,
    );
    if (!ok) {
      throw new ForbiddenException(
        'You are not an owner or active member of the selected team',
      );
    }
    return tid;
  }

  const [fromOk, toOk] = await Promise.all([
    isUserAffiliatedWithMatchTeam(
      match.fromTeam,
      userId,
      teamService,
      teamMemberService,
    ),
    isUserAffiliatedWithMatchTeam(
      match.toTeam,
      userId,
      teamService,
      teamMemberService,
    ),
  ]);

  if (fromOk && toOk) {
    throw new BadRequestException(
      'Provide selfAcceptTeamId because you belong to both teams in this match',
    );
  }
  if (fromOk) {
    return match.fromTeam;
  }
  if (toOk) {
    return match.toTeam;
  }
  throw new ForbiddenException(
    'You must be an owner or active member of one of the teams in this match',
  );
}

/** Pushes a new ACCEPTED slot proposal with a generated id and sets `selectedSlotProposalId`. */
export function appendSelfAcceptedSlotProposal(
  match: TeamMatchDocument,
  slot: { startTime: Date; endTime: Date },
  selfAcceptTeamId: Types.ObjectId,
): Types.ObjectId {
  if (slot.endTime <= slot.startTime) {
    throw new BadRequestException('slot.endTime must be after startTime');
  }
  const proposalId = new Types.ObjectId();
  const now = new Date();
  match.proposedSlots.push({
    proposalId,
    slot: {
      startTime: slot.startTime,
      endTime: slot.endTime,
    },
    proposedByTeamId: selfAcceptTeamId,
    status: MatchProposalStatus.ACCEPTED,
    decidedByTeamId: selfAcceptTeamId,
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  match.selectedSlotProposalId = proposalId;
  return proposalId;
}

/** Pushes a new ACCEPTED turf proposal with a generated id and sets `selectedTurfProposalId`. */
export function appendSelfAcceptedTurfProposal(
  match: TeamMatchDocument,
  turfId: string,
  selfAcceptTeamId: Types.ObjectId,
): Types.ObjectId {
  const proposalId = new Types.ObjectId();
  const now = new Date();
  match.proposedTurfs.push({
    proposalId,
    turfId: new Types.ObjectId(turfId),
    proposedByTeamId: selfAcceptTeamId,
    status: MatchProposalStatus.ACCEPTED,
    decidedByTeamId: selfAcceptTeamId,
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  match.selectedTurfProposalId = proposalId;
  return proposalId;
}
