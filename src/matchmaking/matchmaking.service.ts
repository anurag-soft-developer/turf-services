import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResult } from '../core/interfaces/common';
import { Team, TeamDocument } from '../team/schemas/team.schema';
import { TeamService } from '../team/team.service';
import { TeamMemberService } from '../team-member/team-member.service';
import {
  CancelNegotiationDto,
  DecideSlotProposalDto,
  DecideTurfProposalDto,
  FinalizeScheduleDto,
  ListNegotiationsFilterDto,
  UpdateTeamMatchDto,
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
import {
  TEAM_MATCH_POPULATE,
  TERMINAL_ALL_STATUSES,
} from './util/matchmaking.constants';
import {
  appendSelfAcceptedSlotProposal,
  appendSelfAcceptedTurfProposal,
  resolveSelfAcceptTeamId,
} from './util/matchmaking-staff-selection.helpers';
import {
  applyStatusUpdate,
  assertCanActForTeam,
  assertMatchAllowsProposalWithdraw,
  assertSchedulePhaseActionable,
  assertTeamEligibleForMatching,
  ensureMatchHasTeam,
  getActorTeamIds,
  isSlotProposalWithdrawable,
  isTurfProposalWithdrawable,
  populateTeamMatch,
  requireTeamMatch,
} from './util/matchmaking.helpers';

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
    await assertCanActForTeam(
      fromTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    assertTeamEligibleForMatching(fromTeam);
    assertTeamEligibleForMatching(toTeam);

    if (fromTeam.sportType !== toTeam.sportType) {
      throw new BadRequestException('Teams must be in the same sport');
    }

    if (!toTeam.teamOpenForMatch) {
      throw new BadRequestException(
        'Target team is not open for match requests',
      );
    }

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
        ...(dto.expiresInMinutes != null
          ? {
              expiresAt: new Date(
                Date.now() + dto.expiresInMinutes * 60 * 1000,
              ),
            }
          : {}),
      });
      return populateTeamMatch(created);
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
    const actorTeamIds = await getActorTeamIds(
      userId,
      this.teamModel,
      this.teamMemberService,
    );
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
        .populate(TEAM_MATCH_POPULATE)
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
      requireTeamMatch(this.teamMatchModel, matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    assertSchedulePhaseActionable(match);

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
      applyStatusUpdate(match, TeamMatchStatus.REJECTED, userId);
      match.closedAt = new Date();
    } else {
      applyStatusUpdate(match, TeamMatchStatus.ACCEPTED, userId);
    }

    await match.save();
    return populateTeamMatch(match);
  }

  async proposeSchedule(
    matchId: string,
    userId: string,
    dto: ProposeScheduleDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      requireTeamMatch(this.teamMatchModel, matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    assertSchedulePhaseActionable(match);
    ensureMatchHasTeam(match, actorTeam._id);

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
    applyStatusUpdate(match, TeamMatchStatus.NEGOTIATING, userId);
    match.notes = dto.notes ?? match.notes;
    await match.save();
    return populateTeamMatch(match);
  }

  async decideSlotProposal(
    matchId: string,
    userId: string,
    dto: DecideSlotProposalDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      requireTeamMatch(this.teamMatchModel, matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    ensureMatchHasTeam(match, actorTeam._id);

    if (dto.action === 'withdraw') {
      assertMatchAllowsProposalWithdraw(match);
      const proposal = match.proposedSlots.find(
        (p) => p.proposalId.toString() === dto.proposalId,
      );
      if (!proposal) {
        throw new NotFoundException('Slot proposal not found');
      }
      if (!isSlotProposalWithdrawable(match, proposal)) {
        throw new BadRequestException('Slot proposal cannot be withdrawn');
      }
      proposal.status = MatchProposalStatus.WITHDRAWN;
      proposal.decidedByTeamId = actorTeam._id;
      proposal.decidedAt = new Date();
      proposal.reason = dto.reason;
      proposal.updatedAt = new Date();
      if (match.status === TeamMatchStatus.SCHEDULE_FINALIZED) {
        match.selectedSlotProposalId = undefined;
        applyStatusUpdate(match, TeamMatchStatus.NEGOTIATING, userId);
      }
      await match.save();
      return populateTeamMatch(match);
    }

    assertSchedulePhaseActionable(match);
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
    return populateTeamMatch(match);
  }

  async decideTurfProposal(
    matchId: string,
    userId: string,
    dto: DecideTurfProposalDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      requireTeamMatch(this.teamMatchModel, matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    ensureMatchHasTeam(match, actorTeam._id);

    if (dto.action === 'withdraw') {
      assertMatchAllowsProposalWithdraw(match);
      const proposal = match.proposedTurfs.find(
        (p) => p.proposalId.toString() === dto.proposalId,
      );
      if (!proposal) {
        throw new NotFoundException('Turf proposal not found');
      }

      if (!isTurfProposalWithdrawable(match, proposal)) {
        throw new BadRequestException('Turf proposal cannot be withdrawn');
      }
      proposal.status = MatchProposalStatus.WITHDRAWN;
      proposal.decidedByTeamId = actorTeam._id;
      proposal.decidedAt = new Date();
      proposal.reason = dto.reason;
      proposal.updatedAt = new Date();
      if (match.status === TeamMatchStatus.SCHEDULE_FINALIZED) {
        match.selectedTurfProposalId = undefined;
        applyStatusUpdate(match, TeamMatchStatus.NEGOTIATING, userId);
      }
      await match.save();
      return populateTeamMatch(match);
    }

    assertSchedulePhaseActionable(match);
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
    return populateTeamMatch(match);
  }

  async finalizeSchedule(
    matchId: string,
    userId: string,
    dto: FinalizeScheduleDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      requireTeamMatch(this.teamMatchModel, matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    assertSchedulePhaseActionable(match);
    ensureMatchHasTeam(match, actorTeam._id);

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
    applyStatusUpdate(match, TeamMatchStatus.SCHEDULE_FINALIZED, userId);
    match.notes = dto.notes ?? match.notes;
    await match.save();
    return populateTeamMatch(match);
  }

  async cancel(
    matchId: string,
    userId: string,
    dto: CancelNegotiationDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      requireTeamMatch(this.teamMatchModel, matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    assertSchedulePhaseActionable(match);
    ensureMatchHasTeam(match, actorTeam._id);

    if (
      ![
        TeamMatchStatus.REQUESTED,
        TeamMatchStatus.ACCEPTED,
        TeamMatchStatus.NEGOTIATING,
      ].includes(match.status)
    ) {
      throw new BadRequestException('This match can no longer be cancelled');
    }

    applyStatusUpdate(match, TeamMatchStatus.CANCELLED, userId);
    match.closedAt = new Date();
    if (dto.reason) {
      match.notes = dto.reason;
    }
    await match.save();
    return populateTeamMatch(match);
  }

  async recordMatchResult(
    matchId: string,
    userId: string,
    dto: RecordMatchResultDto,
  ): Promise<TeamMatchDocument> {
    const [match, actorTeam] = await Promise.all([
      requireTeamMatch(this.teamMatchModel, matchId),
      this.teamService.requireTeam(dto.actorTeamId),
    ]);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    ensureMatchHasTeam(match, actorTeam._id);

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
      applyStatusUpdate(match, TeamMatchStatus.ONGOING, userId);
      match.winnerTeam = undefined;
    } else if (dto.outcome === 'draw') {
      applyStatusUpdate(match, TeamMatchStatus.DRAW, userId);
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
      applyStatusUpdate(match, TeamMatchStatus.COMPLETED, userId);
      match.winnerTeam = wid;
      match.closedAt = new Date();
    }

    await match.save();
    return populateTeamMatch(match);
  }

  /**
   * Direct field updates. Optional `slot` / `turfId` add new ACCEPTED self-accept proposals
   * (server generates proposal ids) and set `selectedSlotProposalId` / `selectedTurfProposalId`.
   * `selfAcceptTeamId` or membership disambiguation applies when `slot` and/or `turfId` are sent.
   * When both selected ids are set after the update, status becomes `schedule_finalized`
   * unless the match is already in a terminal pre-play or post-play outcome state.
   */
  async update(
    matchId: string,
    userId: string,
    dto: UpdateTeamMatchDto,
  ): Promise<TeamMatchDocument> {
    const match = await this.teamMatchModel.findById(matchId);
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    if (dto.turfBookingId !== undefined) {
      match.turfBookingId =
        dto.turfBookingId === null
          ? undefined
          : new Types.ObjectId(dto.turfBookingId);
    }
    if (dto.notes !== undefined) {
      match.notes = dto.notes;
    }

    const needsSelfTeam = dto.slot !== undefined || dto.turfId !== undefined;
    const selfTeam = needsSelfTeam
      ? await resolveSelfAcceptTeamId(
          match,
          dto.selfAcceptTeamId,
          userId,
          this.teamService,
          this.teamMemberService,
        )
      : undefined;

    if (dto.slot) {
      appendSelfAcceptedSlotProposal(
        match,
        {
          startTime: new Date(dto.slot.startTime),
          endTime: new Date(dto.slot.endTime),
        },
        selfTeam!,
      );
    }
    if (dto.turfId) {
      appendSelfAcceptedTurfProposal(match, dto.turfId, selfTeam!);
    }

    if (match.selectedSlotProposalId && match.selectedTurfProposalId) {
      const skipFinalize = [
        TeamMatchStatus.REJECTED,
        TeamMatchStatus.EXPIRED,
        TeamMatchStatus.CANCELLED,
        TeamMatchStatus.COMPLETED,
        TeamMatchStatus.DRAW,
        TeamMatchStatus.ONGOING,
      ].includes(match.status);
      if (!skipFinalize) {
        match.status = TeamMatchStatus.SCHEDULE_FINALIZED;
        match.statusUpdatedAt = new Date();
        match.statusUpdatedBy = undefined;
      }
    }

    await match.save();
    return populateTeamMatch(match);
  }
}
