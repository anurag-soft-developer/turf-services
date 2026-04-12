import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PopulateOptions, Types } from 'mongoose';
import { PaginatedResult } from '../core/interfaces/common';
import {
  Team,
  TeamDocument,
  TeamStatus,
  teamPopulateSelectFields,
} from '../team/schemas/team.schema';
import { turfSelectFields } from '../turf/schemas/turf.schema';
import { TeamService } from '../team/team.service';
import { TeamMemberService } from '../team-member/team-member.service';
import {
  LeadershipRole,
  TeamMemberStatus,
} from '../team-member/schemas/team-member.schema';
import {
  CancelNegotiationDto,
  DecideSlotProposalDto,
  DecideTurfProposalDto,
  FinalizeScheduleDto,
  ListNegotiationsFilterDto,
  ProposeScheduleDto,
  RecordMatchResultDto,
  RespondMatchRequestDto,
  SendMatchRequestDto,
} from './dto/matchmaking.dto';
import {
  TeamMatch,
  TeamMatchDocument,
  TeamMatchSource,
  TeamMatchStatus,
  MatchProposalStatus,
} from './schemas/team-match.schema';

const TERMINAL_PRE_PLAY_STATUSES = [
  TeamMatchStatus.REJECTED,
  TeamMatchStatus.EXPIRED,
  TeamMatchStatus.CANCELLED,
];

const TERMINAL_ALL_STATUSES = [
  ...TERMINAL_PRE_PLAY_STATUSES,
  TeamMatchStatus.COMPLETED,
  TeamMatchStatus.DRAW,
];

const teamMatchPopulate: PopulateOptions[] = [
  { path: 'fromTeam', select: teamPopulateSelectFields },
  { path: 'toTeam', select: teamPopulateSelectFields },
  { path: 'proposedTurfs.turfId', select: turfSelectFields },
];

@Injectable()
export class MatchmakingService {
  constructor(
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
  ) {}

  private async populateTeamMatch(
    doc: TeamMatchDocument,
  ): Promise<TeamMatchDocument> {
    return (await doc.populate(teamMatchPopulate)) as TeamMatchDocument;
  }

  async sendRequest(
    userId: string,
    dto: SendMatchRequestDto,
  ): Promise<TeamMatchDocument> {
    if (dto.fromTeamId === dto.toTeamId) {
      throw new BadRequestException('A team cannot request itself');
    }

    const [fromTeam, toTeam] = await Promise.all([
      this.teamService.requireTeam(dto.fromTeamId),
      this.teamService.requireTeam(dto.toTeamId),
    ]);
    await this.assertCanActForTeam(fromTeam, userId);
    this.assertTeamEligibleForMatching(fromTeam);
    this.assertTeamEligibleForMatching(toTeam);

    if (fromTeam.sportType !== toTeam.sportType) {
      throw new BadRequestException('Teams must be in the same sport');
    }

    if (!toTeam.teamOpenForMatch) {
      throw new BadRequestException(
        'Target team is not open for match requests',
      );
    }

    const expiresAt = new Date(Date.now() + dto.expiresInMinutes * 60 * 1000);
    const now = new Date();
    const uid = new Types.ObjectId(userId);

    try {
      const created = await this.teamMatchModel.create({
        source: TeamMatchSource.FEED,
        fromTeam: fromTeam._id,
        toTeam: toTeam._id,
        sportType: fromTeam.sportType,
        status: TeamMatchStatus.REQUESTED,
        statusUpdatedBy: uid,
        statusUpdatedAt: now,
        notes: dto.notes,
        expiresAt,
      });
      return this.populateTeamMatch(created);
    } catch {
      throw new ConflictException(
        'An active match request already exists for this team pair',
      );
    }
  }

  async listRequests(
    userId: string,
    filter: ListNegotiationsFilterDto,
  ): Promise<PaginatedResult<TeamMatchDocument>> {
    const actorTeamIds = await this.getActorTeamIds(userId);
    if (actorTeamIds.length === 0) {
      return {
        data: [],
        totalDocuments: 0,
        page: filter.page,
        limit: filter.limit,
        totalPages: 0,
      };
    }

    const q: Record<string, unknown> = {};
    if (filter.status) {
      q.status = filter.status;
    }

    const hasTeamFilter = !!filter.teamId;
    if (hasTeamFilter) {
      const target = new Types.ObjectId(filter.teamId);
      if (!actorTeamIds.some((t) => t.equals(target))) {
        throw new ForbiddenException('You cannot access this team requests');
      }
      if (filter.type === 'incoming') {
        q.toTeam = target;
      } else if (filter.type === 'outgoing') {
        q.fromTeam = target;
      } else {
        q.$or = [{ fromTeam: target }, { toTeam: target }];
      }
    } else {
      if (filter.type === 'incoming') {
        q.toTeam = { $in: actorTeamIds };
      } else if (filter.type === 'outgoing') {
        q.fromTeam = { $in: actorTeamIds };
      } else {
        q.$or = [
          { fromTeam: { $in: actorTeamIds } },
          { toTeam: { $in: actorTeamIds } },
        ];
      }
    }

    const skip = (filter.page - 1) * filter.limit;
    const [data, totalDocuments] = await Promise.all([
      this.teamMatchModel
        .find(q)
        .populate(teamMatchPopulate)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(filter.limit)
        .exec(),
      this.teamMatchModel.countDocuments(q),
    ]);

    return {
      data,
      totalDocuments,
      page: filter.page,
      limit: filter.limit,
      totalPages: Math.ceil(totalDocuments / filter.limit) || 0,
    };
  }

  async respond(
    matchId: string,
    userId: string,
    dto: RespondMatchRequestDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      this.requireTeamMatch(matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await this.assertCanActForTeam(actorTeam, userId);
    this.assertSchedulePhaseActionable(match);

    if (match.status !== TeamMatchStatus.REQUESTED) {
      throw new BadRequestException(
        'Response is only allowed while status is requested',
      );
    }
    if (actorTeam._id.toString() !== match.toTeam.toString()) {
      throw new ForbiddenException(
        'Only the receiving team can accept or reject the request',
      );
    }

    if (dto.action === 'reject') {
      this.applyStatusUpdate(match, TeamMatchStatus.REJECTED, userId);
      match.closedAt = new Date();
    } else {
      this.applyStatusUpdate(match, TeamMatchStatus.ACCEPTED, userId);
    }

    await match.save();
    return this.populateTeamMatch(match);
  }

  async proposeSchedule(
    matchId: string,
    userId: string,
    dto: ProposeScheduleDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      this.requireTeamMatch(matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await this.assertCanActForTeam(actorTeam, userId);
    this.assertSchedulePhaseActionable(match);
    this.ensureMatchHasTeam(match, actorTeam._id);

    if (
      ![TeamMatchStatus.ACCEPTED, TeamMatchStatus.NEGOTIATING].includes(
        match.status,
      )
    ) {
      throw new BadRequestException(
        'Schedule can be proposed only after the request is accepted',
      );
    }

    const now = new Date();
    if (dto.proposedSlots?.length) {
      for (const proposedSlot of dto.proposedSlots) {
        const startTime = new Date(proposedSlot.startTime);
        const endTime = new Date(proposedSlot.endTime);
        if (endTime <= startTime) {
          throw new BadRequestException(
            'Each slot must have endTime after startTime',
          );
        }
        match.proposedSlots.push({
          proposalId: new Types.ObjectId(),
          slot: { startTime, endTime },
          proposedByTeamId: actorTeam._id,
          status: MatchProposalStatus.PENDING,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    if (dto.proposedTurfIds?.length) {
      for (const proposedTurfId of dto.proposedTurfIds) {
        match.proposedTurfs.push({
          proposalId: new Types.ObjectId(),
          turfId: new Types.ObjectId(proposedTurfId),
          proposedByTeamId: actorTeam._id,
          status: MatchProposalStatus.PENDING,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    this.applyStatusUpdate(match, TeamMatchStatus.NEGOTIATING, userId);
    match.notes = dto.notes ?? match.notes;
    await match.save();
    return this.populateTeamMatch(match);
  }

  async decideSlotProposal(
    matchId: string,
    userId: string,
    dto: DecideSlotProposalDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      this.requireTeamMatch(matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await this.assertCanActForTeam(actorTeam, userId);
    this.ensureMatchHasTeam(match, actorTeam._id);

    if (dto.action === 'withdraw') {
      this.assertMatchAllowsProposalWithdraw(match);
      const proposal = match.proposedSlots.find(
        (p) => p.proposalId.toString() === dto.proposalId,
      );
      if (!proposal) {
        throw new NotFoundException('Slot proposal not found');
      }
      if (!this.isSlotProposalWithdrawable(match, proposal)) {
        throw new BadRequestException('Slot proposal cannot be withdrawn');
      }
      proposal.status = MatchProposalStatus.WITHDRAWN;
      proposal.decidedByTeamId = actorTeam._id;
      proposal.decidedAt = new Date();
      proposal.reason = dto.reason;
      proposal.updatedAt = new Date();
      if (match.status === TeamMatchStatus.SCHEDULE_FINALIZED) {
        match.selectedSlotProposalId = undefined;
        this.applyStatusUpdate(match, TeamMatchStatus.NEGOTIATING, userId);
      }
      await match.save();
      return this.populateTeamMatch(match);
    }

    this.assertSchedulePhaseActionable(match);
    if (match.status !== TeamMatchStatus.NEGOTIATING) {
      throw new BadRequestException(
        'Slot decisions are allowed only while negotiating',
      );
    }

    const proposal = match.proposedSlots.find(
      (p) => p.proposalId.toString() === dto.proposalId,
    );
    if (!proposal) {
      throw new NotFoundException('Slot proposal not found');
    }
    if (proposal.proposedByTeamId.toString() === actorTeam._id.toString()) {
      throw new ForbiddenException(
        'Proposer cannot decide its own slot proposal',
      );
    }

    proposal.status =
      dto.action === 'accept'
        ? MatchProposalStatus.ACCEPTED
        : MatchProposalStatus.REJECTED;
    proposal.decidedByTeamId = actorTeam._id;
    proposal.decidedAt = new Date();
    proposal.reason = dto.reason;
    proposal.updatedAt = new Date();
    await match.save();
    return this.populateTeamMatch(match);
  }

  async decideTurfProposal(
    matchId: string,
    userId: string,
    dto: DecideTurfProposalDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      this.requireTeamMatch(matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await this.assertCanActForTeam(actorTeam, userId);
    this.ensureMatchHasTeam(match, actorTeam._id);

    if (dto.action === 'withdraw') {
      this.assertMatchAllowsProposalWithdraw(match);
      const proposal = match.proposedTurfs.find(
        (p) => p.proposalId.toString() === dto.proposalId,
      );
      if (!proposal) {
        throw new NotFoundException('Turf proposal not found');
      }

      if (!this.isTurfProposalWithdrawable(match, proposal)) {
        throw new BadRequestException('Turf proposal cannot be withdrawn');
      }
      proposal.status = MatchProposalStatus.WITHDRAWN;
      proposal.decidedByTeamId = actorTeam._id;
      proposal.decidedAt = new Date();
      proposal.reason = dto.reason;
      proposal.updatedAt = new Date();
      if (match.status === TeamMatchStatus.SCHEDULE_FINALIZED) {
        match.selectedTurfProposalId = undefined;
        this.applyStatusUpdate(match, TeamMatchStatus.NEGOTIATING, userId);
      }
      await match.save();
      return this.populateTeamMatch(match);
    }

    this.assertSchedulePhaseActionable(match);
    if (match.status !== TeamMatchStatus.NEGOTIATING) {
      throw new BadRequestException(
        'Turf decisions are allowed only while negotiating',
      );
    }

    const proposal = match.proposedTurfs.find(
      (p) => p.proposalId.toString() === dto.proposalId,
    );
    if (!proposal) {
      throw new NotFoundException('Turf proposal not found');
    }
    if (proposal.proposedByTeamId.toString() === actorTeam._id.toString()) {
      throw new ForbiddenException(
        'Proposer cannot decide its own turf proposal',
      );
    }

    proposal.status =
      dto.action === 'accept'
        ? MatchProposalStatus.ACCEPTED
        : MatchProposalStatus.REJECTED;
    proposal.decidedByTeamId = actorTeam._id;
    proposal.decidedAt = new Date();
    proposal.reason = dto.reason;
    proposal.updatedAt = new Date();
    await match.save();
    return this.populateTeamMatch(match);
  }

  async finalizeSchedule(
    matchId: string,
    userId: string,
    dto: FinalizeScheduleDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      this.requireTeamMatch(matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await this.assertCanActForTeam(actorTeam, userId);
    this.assertSchedulePhaseActionable(match);
    this.ensureMatchHasTeam(match, actorTeam._id);

    if (match.status !== TeamMatchStatus.NEGOTIATING) {
      throw new BadRequestException(
        'Finalize is allowed only while negotiating',
      );
    }

    const slotProposal = match.proposedSlots.find(
      (p) => p.proposalId.toString() === dto.slotProposalId,
    );
    const turfProposal = match.proposedTurfs.find(
      (p) => p.proposalId.toString() === dto.turfProposalId,
    );
    if (!slotProposal || !turfProposal) {
      throw new BadRequestException(
        'Selected slot and turf proposals must exist',
      );
    }
    if (
      slotProposal.status !== MatchProposalStatus.ACCEPTED ||
      turfProposal.status !== MatchProposalStatus.ACCEPTED
    ) {
      throw new BadRequestException(
        'Selected slot and turf proposals must be accepted',
      );
    }

    match.selectedSlotProposalId = slotProposal.proposalId;
    match.selectedTurfProposalId = turfProposal.proposalId;
    this.applyStatusUpdate(match, TeamMatchStatus.SCHEDULE_FINALIZED, userId);
    match.notes = dto.notes ?? match.notes;
    await match.save();
    return this.populateTeamMatch(match);
  }

  async cancel(
    matchId: string,
    userId: string,
    dto: CancelNegotiationDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      this.requireTeamMatch(matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await this.assertCanActForTeam(actorTeam, userId);
    this.assertSchedulePhaseActionable(match);
    this.ensureMatchHasTeam(match, actorTeam._id);

    if (
      ![
        TeamMatchStatus.REQUESTED,
        TeamMatchStatus.ACCEPTED,
        TeamMatchStatus.NEGOTIATING,
      ].includes(match.status)
    ) {
      throw new BadRequestException('This match can no longer be cancelled');
    }

    this.applyStatusUpdate(match, TeamMatchStatus.CANCELLED, userId);
    match.closedAt = new Date();
    if (dto.reason) {
      match.notes = dto.reason;
    }
    await match.save();
    return this.populateTeamMatch(match);
  }

  async recordMatchResult(
    matchId: string,
    userId: string,
    dto: RecordMatchResultDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      this.requireTeamMatch(matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await this.assertCanActForTeam(actorTeam, userId);
    this.ensureMatchHasTeam(match, actorTeam._id);

    if (TERMINAL_ALL_STATUSES.includes(match.status)) {
      throw new BadRequestException('Match is already closed');
    }

    if (
      ![TeamMatchStatus.SCHEDULE_FINALIZED, TeamMatchStatus.ONGOING].includes(
        match.status,
      )
    ) {
      throw new BadRequestException(
        'Match result can be recorded only after schedule is finalized',
      );
    }

    if (dto.outcome === 'ongoing') {
      this.applyStatusUpdate(match, TeamMatchStatus.ONGOING, userId);
      match.winnerTeam = undefined;
    } else if (dto.outcome === 'draw') {
      this.applyStatusUpdate(match, TeamMatchStatus.DRAW, userId);
      match.winnerTeam = undefined;
      match.closedAt = new Date();
    } else {
      if (!dto.winnerTeam) {
        throw new BadRequestException(
          'winnerTeam is required when outcome is completed',
        );
      }
      const wid = new Types.ObjectId(dto.winnerTeam);
      if (
        wid.toString() !== match.fromTeam.toString() &&
        wid.toString() !== match.toTeam.toString()
      ) {
        throw new BadRequestException('Winner must be one of the two teams');
      }
      this.applyStatusUpdate(match, TeamMatchStatus.COMPLETED, userId);
      match.winnerTeam = wid;
      match.closedAt = new Date();
    }

    await match.save();
    return this.populateTeamMatch(match);
  }

  private applyStatusUpdate(
    doc: TeamMatchDocument,
    status: TeamMatchStatus,
    userId: string,
  ): void {
    doc.status = status;
    doc.statusUpdatedBy = new Types.ObjectId(userId);
    doc.statusUpdatedAt = new Date();
  }

  private async requireTeamMatch(matchId: string): Promise<TeamMatchDocument> {
    const doc = await this.teamMatchModel.findById(matchId);
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

  private async assertCanActForTeam(
    team: TeamDocument,
    userId: string,
  ): Promise<void> {
    if (this.teamService.isOwner(team, userId)) {
      return;
    }
    const isLeadership =
      await this.teamMemberService.hasActiveLeadershipMembership(
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

  private assertTeamEligibleForMatching(team: TeamDocument): void {
    if (team.status !== TeamStatus.ACTIVE) {
      throw new BadRequestException('Only active teams can use matchmaking');
    }
  }

  private ensureMatchHasTeam(
    match: TeamMatchDocument,
    teamId: Types.ObjectId,
  ): void {
    if (
      match.fromTeam.toString() !== teamId.toString() &&
      match.toTeam.toString() !== teamId.toString()
    ) {
      throw new ForbiddenException('Team is not part of this match');
    }
  }

  private assertMatchAllowsProposalWithdraw(match: TeamMatchDocument): void {
    if (
      TERMINAL_PRE_PLAY_STATUSES.includes(match.status) ||
      match.status === TeamMatchStatus.ONGOING ||
      match.status === TeamMatchStatus.COMPLETED ||
      match.status === TeamMatchStatus.DRAW
    ) {
      throw new BadRequestException(
        'Proposals cannot be withdrawn for this match state',
      );
    }
  }

  private isSlotProposalWithdrawable(
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
      match.selectedSlotProposalId.toString() === proposal.proposalId.toString()
    ) {
      return true;
    }
    return false;
  }

  private isTurfProposalWithdrawable(
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
      match.selectedTurfProposalId.toString() === proposal.proposalId.toString()
    ) {
      return true;
    }
    return false;
  }

  /** Blocks terminal states for request/schedule negotiation APIs. */
  private assertSchedulePhaseActionable(match: TeamMatchDocument): void {
    if (
      TERMINAL_PRE_PLAY_STATUSES.includes(match.status) ||
      match.status === TeamMatchStatus.SCHEDULE_FINALIZED ||
      match.status === TeamMatchStatus.ONGOING ||
      match.status === TeamMatchStatus.COMPLETED ||
      match.status === TeamMatchStatus.DRAW
    ) {
      throw new BadRequestException(
        'This match can no longer be updated this way',
      );
    }
  }

  private async getActorTeamIds(userId: string): Promise<Types.ObjectId[]> {
    const uid = new Types.ObjectId(userId);
    const [ownedTeams, leadershipTeamIds] = await Promise.all([
      this.teamModel.distinct('_id', { ownerIds: uid }),
      this.teamMemberService.distinctTeamIdsByMembershipFilter({
        user: uid,
        status: TeamMemberStatus.ACTIVE,
        leadershipRole: {
          $in: [LeadershipRole.CAPTAIN, LeadershipRole.VICE_CAPTAIN],
        },
      }),
    ]);
    const all = new Map<string, Types.ObjectId>();
    for (const id of [...ownedTeams, ...leadershipTeamIds]) {
      all.set(id.toString(), id);
    }
    return [...all.values()];
  }
}
