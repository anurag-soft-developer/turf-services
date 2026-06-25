import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model, PopulateOptions, Types } from 'mongoose';
import {
  LeadershipRole,
  TeamMemberStatus,
} from '../../team-member/schemas/team-member.schema';
import { TeamMemberService } from '../../team-member/team-member.service';
import {
  Team,
  TeamDocument,
  TeamStatus,
} from '../../team/schemas/team.schema';
import { TeamService } from '../../team/team.service';
import {
  MatchProposalStatus,
  TeamMatchDocument,
  TeamMatchStatus,
} from '../schemas/team-match.schema';
import {
  TEAM_MATCH_POPULATE,
  TERMINAL_ALL_STATUSES,
  TERMINAL_PRE_PLAY_STATUSES,
} from './matchmaking.constants';
import { resolveId } from '../../core/utils/mongo-ref.util';

/** Blocks squad edits once the match is terminal or cricket scoring has started. */
export function assertMatchAllowsAnnouncedPlayerEdits(
  match: TeamMatchDocument,
): void {
  if (TERMINAL_ALL_STATUSES.includes(match.status)) {
    throw new BadRequestException(
      'Cannot change announced players after this match has ended',
    );
  }
  if (match.cricketState) {
    throw new BadRequestException(
      'Cannot change announced players after cricket scoring has started',
    );
  }
}

export async function populateTeamMatch(
  doc: TeamMatchDocument,
  populate: PopulateOptions[] = TEAM_MATCH_POPULATE,
): Promise<TeamMatchDocument> {
  return (await doc.populate(populate)) as TeamMatchDocument;
}

export function applyStatusUpdate(
  doc: TeamMatchDocument,
  status: TeamMatchStatus,
  userId: string,
): void {
  doc.status = status;
  doc.statusUpdatedBy = new Types.ObjectId(userId);
  doc.statusUpdatedAt = new Date();
}

export async function requireTeamMatch(
  teamMatchModel: Model<TeamMatchDocument>,
  matchId: string,
): Promise<TeamMatchDocument> {
  const doc = await teamMatchModel.findById(matchId);
  if (!doc) {
    throw new NotFoundException('Match not found');
  }
  if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
    if (!TERMINAL_ALL_STATUSES.includes(doc.status)) {
      doc.status = TeamMatchStatus.EXPIRED;
      doc.closedAt = new Date();
      doc.statusUpdatedAt = new Date();
      doc.statusUpdatedBy = undefined;
      await doc.save();
    }
  }
  return doc;
}

export async function assertCanActForTeam(
  team: TeamDocument,
  userId: string,
  teamService: TeamService,
  teamMemberService: TeamMemberService,
): Promise<void> {
  if (teamService.isOwner(team, userId)) {
    return;
  }
  const isLeadership =
    await teamMemberService.hasActiveLeadershipMembership(
      team._id.toString(),
      userId,
      [LeadershipRole.CAPTAIN, LeadershipRole.VICE_CAPTAIN],
    );
  if (!isLeadership) {
    throw new ForbiddenException(
      'Only owners, captains, or vice captains can perform this action',
    );
  }
}

export function assertTeamEligibleForMatching(team: TeamDocument): void {
  if (team.status !== TeamStatus.ACTIVE) {
    throw new BadRequestException('Only active teams can use matchmaking');
  }
}

export function ensureMatchHasTeam(
  match: TeamMatchDocument,
  teamId: Types.ObjectId,
): void {
  if (
    resolveId(match.fromTeam) !== resolveId(teamId) &&
    resolveId(match.toTeam) !== resolveId(teamId)
  ) {
    throw new ForbiddenException('Team is not part of this match');
  }
}

export function assertMatchAllowsProposalWithdraw(
  match: TeamMatchDocument,
): void {
  if (
    TERMINAL_PRE_PLAY_STATUSES.includes(match.status) ||
    match.status === TeamMatchStatus.ONGOING ||
    match.status === TeamMatchStatus.COMPLETED ||
    match.status === TeamMatchStatus.DRAW ||
    match.status === TeamMatchStatus.ABANDONED
  ) {
    throw new BadRequestException(
      'Proposals cannot be withdrawn for this match state',
    );
  }
}

export function isSlotProposalWithdrawable(
  match: TeamMatchDocument,
  proposal: TeamMatchDocument['proposedSlots'][number],
): boolean {
  if (proposal.status === MatchProposalStatus.PENDING) {
    return true;
  }
  if (
    match.status === TeamMatchStatus.SCHEDULE_FINALIZED &&
    proposal.status === MatchProposalStatus.ACCEPTED &&
    match.selectedSlotProposalId &&
    resolveId(match.selectedSlotProposalId) === resolveId(proposal.proposalId)
  ) {
    return true;
  }
  return false;
}

export function isTurfProposalWithdrawable(
  match: TeamMatchDocument,
  proposal: TeamMatchDocument['proposedTurfs'][number],
): boolean {
  if (proposal.status === MatchProposalStatus.PENDING) {
    return true;
  }
  if (
    match.status === TeamMatchStatus.SCHEDULE_FINALIZED &&
    proposal.status === MatchProposalStatus.ACCEPTED &&
    match.selectedTurfProposalId &&
    resolveId(match.selectedTurfProposalId) === resolveId(proposal.proposalId)
  ) {
    return true;
  }
  return false;
}

/** Blocks terminal states for request/schedule negotiation APIs. */
export function assertSchedulePhaseActionable(
  match: TeamMatchDocument,
): void {
  if (
    TERMINAL_PRE_PLAY_STATUSES.includes(match.status) ||
    match.status === TeamMatchStatus.SCHEDULE_FINALIZED ||
    match.status === TeamMatchStatus.ONGOING ||
    match.status === TeamMatchStatus.COMPLETED ||
    match.status === TeamMatchStatus.DRAW ||
    match.status === TeamMatchStatus.ABANDONED
  ) {
    throw new BadRequestException(
      'This match can no longer be updated this way',
    );
  }
}

export type ScopedTeamIdsFilter = {
  teamId?: string;
  teamIds?: string[];
};

export function parseScopedTeamIds(
  filter: ScopedTeamIdsFilter,
): Types.ObjectId[] {
  const explicitTeamIdStrings: string[] = [];
  if (filter.teamIds?.length) {
    explicitTeamIdStrings.push(...filter.teamIds);
  } else if (filter.teamId) {
    explicitTeamIdStrings.push(filter.teamId);
  }

  const scopedTeamIds: Types.ObjectId[] = [];
  for (const id of explicitTeamIdStrings) {
    let oid: Types.ObjectId;
    try {
      oid = new Types.ObjectId(id);
    } catch {
      throw new BadRequestException('Invalid team id');
    }
    scopedTeamIds.push(oid);
  }
  return [
    ...new Map(scopedTeamIds.map((o) => [o.toString(), o])).values(),
  ];
}

/** Active challenge inbox: requested (non-expired), accepted, negotiating. */
export function buildPreMatchInboxStatusClause(
  now = new Date(),
): Record<string, unknown> {
  return {
    $and: [
      {
        status: {
          $in: [
            TeamMatchStatus.REQUESTED,
            TeamMatchStatus.ACCEPTED,
            TeamMatchStatus.NEGOTIATING,
          ],
        },
      },
      {
        $or: [
          { status: { $ne: TeamMatchStatus.REQUESTED } },
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gte: now } },
        ],
      },
    ],
  };
}

export async function getActorTeamIds(
  userId: string,
  teamModel: Model<TeamDocument>,
  teamMemberService: TeamMemberService,
): Promise<Types.ObjectId[]> {
  const uid = new Types.ObjectId(userId);
  const [ownedTeams, leadershipTeamIds] = await Promise.all([
    teamModel.distinct('_id', { ownerIds: uid }),
    teamMemberService.distinctTeamIdsByMembershipFilter({
      user: uid,
      status: TeamMemberStatus.ACTIVE,
      // leadershipRole: {
      //   $in: [LeadershipRole.CAPTAIN, LeadershipRole.VICE_CAPTAIN],
      // },
    }),
  ]);
  const all = new Map<string, Types.ObjectId>();
  for (const id of [...ownedTeams, ...leadershipTeamIds]) {
    all.set(id.toString(), id);
  }
  return [...all.values()];
}
