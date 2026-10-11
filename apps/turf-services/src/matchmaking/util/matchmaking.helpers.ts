import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model, PopulateOptions, Types } from 'mongoose';
import {
  LeadershipRole,
  TeamMemberStatus,
} from '../../team-member/schemas/team-member.schema';
import { TeamMemberService } from '../../team-member/team-member.service';
import { Team, TeamDocument, TeamStatus } from '../../team/schemas/team.schema';
import { TeamService } from '../../team/team.service';
import {
  MatchProposalStatus,
  TeamMatchDocument,
  TeamMatchSource,
  TeamMatchStatus,
} from '../schemas/team-match.schema';
import {
  TEAM_MATCH_POPULATE,
  TERMINAL_ALL_STATUSES,
  TERMINAL_PRE_PLAY_STATUSES,
} from './matchmaking.constants';
import { resolveId, resolveIdOrNull } from '../../core/utils/mongo-ref.util';

/** Active matches that can collide on scheduled time for the same team pair. */
export const SLOT_OVERLAP_ACTIVE_STATUSES: TeamMatchStatus[] = [
  TeamMatchStatus.REQUESTED,
  TeamMatchStatus.ACCEPTED,
  TeamMatchStatus.NEGOTIATING,
  TeamMatchStatus.SCHEDULE_FINALIZED,
  TeamMatchStatus.ONGOING,
];

export function timeRangesOverlap(
  a: { startTime: Date; endTime: Date },
  b: { startTime: Date; endTime: Date },
): boolean {
  return a.startTime < b.endTime && a.endTime > b.startTime;
}

/** Resolved selected slot on a match, if any. */
export function selectedSlotOf(
  match: Pick<TeamMatchDocument, 'proposedSlots' | 'selectedSlotProposalId'>,
): { startTime: Date; endTime: Date } | null {
  if (!match.selectedSlotProposalId) return null;
  const selectedId = resolveId(match.selectedSlotProposalId);
  const proposal = (match.proposedSlots ?? []).find(
    (p) => resolveId(p.proposalId) === selectedId,
  );
  if (!proposal?.slot) return null;
  return {
    startTime: new Date(proposal.slot.startTime),
    endTime: new Date(proposal.slot.endTime),
  };
}

/**
 * Same team pair may have multiple active matches; only overlapping
 * selected slots are rejected. No-op when [slot] is omitted.
 */
export async function assertNoOverlappingMatchSlot(
  teamMatchModel: Model<TeamMatchDocument>,
  fromTeamId: Types.ObjectId,
  toTeamId: Types.ObjectId,
  slot: { startTime: Date; endTime: Date } | undefined,
  excludeMatchId?: Types.ObjectId | string,
): Promise<void> {
  if (!slot) return;
  if (!(slot.endTime > slot.startTime)) {
    throw new BadRequestException('slot.endTime must be after startTime');
  }

  const filter: Record<string, unknown> = {
    status: { $in: SLOT_OVERLAP_ACTIVE_STATUSES },
    selectedSlotProposalId: { $exists: true, $ne: null },
    $or: [
      { fromTeam: fromTeamId, toTeam: toTeamId },
      { fromTeam: toTeamId, toTeam: fromTeamId },
    ],
  };
  if (excludeMatchId) {
    filter._id = { $ne: new Types.ObjectId(excludeMatchId.toString()) };
  }

  const candidates = await teamMatchModel
    .find(filter)
    .select({ proposedSlots: 1, selectedSlotProposalId: 1 })
    .lean()
    .exec();

  for (const match of candidates) {
    const existing = selectedSlotOf(
      match as Pick<
        TeamMatchDocument,
        'proposedSlots' | 'selectedSlotProposalId'
      >,
    );
    if (existing && timeRangesOverlap(slot, existing)) {
      throw new ConflictException(
        'An active match already exists for this team pair in this time range',
      );
    }
  }
}

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

export function assertUnranked(match: TeamMatchDocument): void {
  if (match.source !== TeamMatchSource.UNRANKED) {
    throw new BadRequestException(
      'This action is only available on unranked matches',
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
  const isLeadership = await teamMemberService.hasActiveLeadershipMembership(
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

export function assertMatchHasBothTeams(match: TeamMatchDocument): void {
  if (
    resolveIdOrNull(match.fromTeam) == null ||
    resolveIdOrNull(match.toTeam) == null
  ) {
    throw new BadRequestException(
      'Both teams must be set before this match can be played',
    );
  }
}

export function ensureMatchHasTeam(
  match: TeamMatchDocument,
  teamId: Types.ObjectId,
): void {
  const side = resolveId(teamId);
  if (
    resolveIdOrNull(match.fromTeam) !== side &&
    resolveIdOrNull(match.toTeam) !== side
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
export function assertSchedulePhaseActionable(match: TeamMatchDocument): void {
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
  return [...new Map(scopedTeamIds.map((o) => [o.toString(), o])).values()];
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

/** `null` means the list cannot be satisfied (e.g. search matched nothing). */
export async function buildListRequestsQuery(
  userId: string,
  filter: {
    scope?: 'mine' | 'all';
    statuses?: string[];
    status?: string;
    sportType?: string;
    type?: 'incoming' | 'outgoing' | 'all';
    search?: string;
    teamId?: string;
    teamIds?: string[];
    source?: TeamMatchSource;
  },
  teamModel: Model<TeamDocument>,
  teamMemberService: TeamMemberService,
): Promise<Record<string, unknown> | null> {
  const scope = filter.scope ?? 'mine';
  const uniqueScoped = parseScopedTeamIds(filter);
  const hasExplicitTeamFilter = uniqueScoped.length > 0;

  let actorTeamIds: Types.ObjectId[] = [];
  if (scope === 'mine' && !hasExplicitTeamFilter) {
    actorTeamIds = await getActorTeamIds(userId, teamModel, teamMemberService);
  }

  const andClauses: Record<string, unknown>[] = [];

  const statusStrings: string[] = [];
  if (filter.statuses?.length) {
    statusStrings.push(...filter.statuses);
  } else if (filter.status) {
    statusStrings.push(filter.status);
  }
  const uniqueStatuses = [...new Set(statusStrings)];
  if (uniqueStatuses.length > 0) {
    andClauses.push({ status: uniqueStatuses });
  }

  if (filter.sportType) {
    andClauses.push({ sportType: filter.sportType });
  }

  if (filter.source) {
    andClauses.push({ source: filter.source });
  }

  if (scope === 'mine' || hasExplicitTeamFilter) {
    const scopedTeamIds = hasExplicitTeamFilter ? uniqueScoped : actorTeamIds;
    if (hasExplicitTeamFilter) {
      if (filter.type === 'incoming') {
        andClauses.push({ toTeam: scopedTeamIds });
      } else if (filter.type === 'outgoing') {
        andClauses.push({ fromTeam: scopedTeamIds });
      } else {
        andClauses.push({
          $or: [{ fromTeam: scopedTeamIds }, { toTeam: scopedTeamIds }],
        });
      }
    } else {
      const uid = new Types.ObjectId(userId);
      const accessClauses: Record<string, unknown>[] = [];
      if (scopedTeamIds.length > 0) {
        if (filter.type === 'incoming') {
          accessClauses.push({ toTeam: scopedTeamIds });
        } else if (filter.type === 'outgoing') {
          accessClauses.push({ fromTeam: scopedTeamIds });
        } else {
          accessClauses.push(
            { fromTeam: scopedTeamIds },
            { toTeam: scopedTeamIds },
          );
        }
      }
      accessClauses.push({ associatedUserIds: uid });
      andClauses.push(
        accessClauses.length === 1
          ? accessClauses[0]
          : { $or: accessClauses },
      );
    }
  }

  const search = filter.search?.trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escaped, 'i');
    const matchedTeams = await teamModel
      .find({
        $or: [{ name: searchRegex }, { shortName: searchRegex }],
      })
      .select('_id')
      .lean()
      .exec();
    const searchTeamIds = matchedTeams.map((t) => t._id);
    if (searchTeamIds.length === 0) {
      return null;
    }
    andClauses.push({
      $or: [{ fromTeam: searchTeamIds }, { toTeam: searchTeamIds }],
    });
  }

  if (andClauses.length === 0) return {};
  if (andClauses.length === 1) return andClauses[0];
  return { $and: andClauses };
}
