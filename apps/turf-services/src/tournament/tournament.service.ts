import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { resolveId, resolveIdOrNull } from '../core/utils/mongo-ref.util';
import {
  TeamMatch,
  TeamMatchDocument,
  TeamMatchSource,
  TeamMatchStatus,
} from '../matchmaking/schemas/team-match.schema';
import { NotificationService } from '../notification/notification.service';
import {
  LeadershipRole,
  TeamMember,
  TeamMemberStatus,
} from '../team-member/schemas/team-member.schema';
import { SCORING_SPORT_TYPES } from '../core/sports/sport-types';
import {
  SportType,
  Team,
  TeamDocument,
  TeamStatus,
} from '../team/schemas/team.schema';
import { TeamService } from '../team/team.service';
import { UsersService } from '../users/users.service';
import {
  InvitationKind,
  InvitationStatus,
  TournamentInvitationDirection,
} from '../invitations/invitation.constants';
import {
  Invitation,
  InvitationDocument,
} from '../invitations/schemas/invitation.schema';
import { requireForTournament } from '../invitations/shared/invitation-asserts.util';
import {
  BracketWinnerDto,
  AddOrganizerDto,
  CreateTournamentDto,
  ListTournamentsDto,
  QualifierPickDto,
  UpdateFixtureTeamsDto,
  UpdateTournamentDto,
} from './dto/tournament.dto';
import { Tournament, TournamentDocument } from './schemas/tournament.schema';
import { TournamentDrawService } from './tournament-draw.service';
import {
  assertFeederSideStillOpen,
  assignFixtureSide,
  isUnstartedFixture,
  matchesFedBy,
  ROUND_SLOT_FREE,
} from './util/tournament-bracket.util';
import {
  hybridKnockoutBracketSize,
  TournamentFormat,
  TournamentStage,
  TournamentStatus,
} from './tournament.constants';
import {
  organizerIdList,
  requireOrganizer,
  requireTournament,
} from './util/tournament-asserts.util';
import {
  knockoutFullBracketPlans,
  openingFixturePlans,
} from './util/tournament-draw.util';
import {
  assertTournamentSize,
  assertTournamentSizeIfSet,
  isTournamentRosterLocked,
  requireTournamentMaxTeams,
} from './util/tournament-entry.util';
import { notifyEntryDecision } from './util/tournament-notification.utility';

const TEAM_SUMMARY = 'name shortName logo sportType location';
const ORGANIZER_POPULATE = {
  path: 'organizerIds',
  select: '_id fullName avatar',
};

@Injectable()
export class TournamentService {
  constructor(
    @InjectModel(Tournament.name)
    private readonly tournamentModel: Model<TournamentDocument>,
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<InvitationDocument>,
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMember>,
    private readonly teamService: TeamService,
    private readonly usersService: UsersService,
    private readonly notificationService: NotificationService,
    private readonly drawService: TournamentDrawService,
  ) {}

  async create(
    userId: string,
    dto: CreateTournamentDto,
  ): Promise<TournamentDocument> {
    assertTournamentSizeIfSet(dto.format, dto.maxTeams);
    return this.tournamentModel.create({
      name: dto.name,
      organizerUserId: new Types.ObjectId(userId),
      organizerIds: [new Types.ObjectId(userId)],
      sportType: dto.sportType as SportType,
      format: dto.format,
      status: dto.asDraft ? TournamentStatus.DRAFT : TournamentStatus.INVITING,
      ...(dto.maxTeams != null ? { maxTeams: dto.maxTeams } : {}),
      maxOvers: dto.maxOvers,
      coverImages: dto.coverImages ?? [],
      description: dto.description,
      venueName: dto.venueName,
      startDate: dto.startDate,
      endDate: dto.endDate,
      registrationDeadline: dto.registrationDeadline,
      isPublic: dto.isPublic ?? true,
      ...(dto.format === TournamentFormat.HYBRID && dto.maxTeams != null
        ? { advanceCount: hybridKnockoutBracketSize(dto.maxTeams) }
        : {}),
    });
  }

  async updateDraft(
    userId: string,
    tournamentId: string,
    dto: UpdateTournamentDto,
  ): Promise<TournamentDocument> {
    const tournament = await requireOrganizer(this.tournamentModel, tournamentId, userId);
    if (
      tournament.status !== TournamentStatus.DRAFT &&
      tournament.status !== TournamentStatus.INVITING
    ) {
      throw new BadRequestException('This tournament can no longer be edited');
    }
    const rosterLocked = isTournamentRosterLocked(tournament);
    if (
      rosterLocked &&
      (dto.format !== undefined ||
        dto.maxTeams !== undefined ||
        dto.sportType !== undefined)
    ) {
      throw new BadRequestException(
        'Cannot change format, sport, or capacity after the roster is locked',
      );
    }
    if (dto.name !== undefined) {
      tournament.name = dto.name;
    }
    if (dto.format !== undefined) {
      tournament.format = dto.format;
    }
    if (dto.maxTeams !== undefined) {
      tournament.maxTeams = dto.maxTeams;
    }
    if (dto.maxOvers !== undefined) {
      tournament.maxOvers = dto.maxOvers;
    }
    if (dto.coverImages !== undefined) {
      tournament.coverImages = dto.coverImages ?? [];
    }
    if (dto.sportType !== undefined) {
      tournament.sportType = dto.sportType as SportType;
    }
    if (dto.description !== undefined) {
      tournament.description = dto.description;
    }
    if (dto.venueName !== undefined) {
      tournament.venueName = dto.venueName;
    }
    if (dto.startDate !== undefined) {
      tournament.startDate = dto.startDate;
    }
    if (dto.endDate !== undefined) {
      tournament.endDate = dto.endDate;
    }
    if (dto.registrationDeadline !== undefined) {
      tournament.registrationDeadline = dto.registrationDeadline;
    }
    if (dto.isPublic !== undefined) {
      tournament.isPublic = dto.isPublic;
    }
    assertTournamentSizeIfSet(tournament.format, tournament.maxTeams);
    if (tournament.format === TournamentFormat.HYBRID && tournament.maxTeams != null) {
      tournament.advanceCount = hybridKnockoutBracketSize(tournament.maxTeams);
      tournament.groupSize = undefined;
    } else if (tournament.format !== TournamentFormat.HYBRID) {
      tournament.groupSize = undefined;
      tournament.advanceCount = undefined;
    }
    return tournament.save();
  }

  async publish(userId: string, tournamentId: string): Promise<TournamentDocument> {
    const tournament = await requireOrganizer(this.tournamentModel, tournamentId, userId);
    if (tournament.status !== TournamentStatus.DRAFT) {
      throw new BadRequestException('Only a draft tournament can be opened');
    }
    assertTournamentSizeIfSet(tournament.format, tournament.maxTeams);
    tournament.status = TournamentStatus.INVITING;
    return tournament.save();
  }

  async cancel(userId: string, tournamentId: string): Promise<TournamentDocument> {
    const tournament = await requireOrganizer(this.tournamentModel, tournamentId, userId);
    if (
      tournament.status === TournamentStatus.COMPLETED ||
      tournament.status === TournamentStatus.CANCELLED
    ) {
      throw new BadRequestException('This tournament can no longer be cancelled');
    }
    tournament.status = TournamentStatus.CANCELLED;
    await tournament.save();
    await this.teamMatchModel.updateMany(
      {
        tournamentId: tournament._id,
        status: TeamMatchStatus.SCHEDULE_FINALIZED,
      },
      {
        $set: {
          status: TeamMatchStatus.CANCELLED,
          closedAt: new Date(),
          statusUpdatedAt: new Date(),
          statusUpdatedBy: new Types.ObjectId(userId),
        },
      },
    );
    return tournament;
  }

  async remove(userId: string, tournamentId: string): Promise<void> {
    const tournament = await requireOrganizer(this.tournamentModel, tournamentId, userId);
    if (
      tournament.status !== TournamentStatus.DRAFT &&
      tournament.status !== TournamentStatus.INVITING
    ) {
      throw new BadRequestException(
        'Only a tournament that has not started can be deleted',
      );
    }
    await this.teamMatchModel.deleteMany({ tournamentId: tournament._id });
    await this.invitationModel.deleteMany({
      kind: InvitationKind.TOURNAMENT_INVITE,
      tournament: tournament._id,
    });
    await tournament.deleteOne();
  }

  async listOpen(query: ListTournamentsDto) {
    const filter: Record<string, unknown> = {
      isPublic: true,
      sportType: { $in: SCORING_SPORT_TYPES },
    };
    filter.status = query.status?.length
      ? { $in: query.status }
      : TournamentStatus.INVITING;
    return this.paginate(filter, query.page, query.limit);
  }

  async listMine(userId: string, query: ListTournamentsDto) {
    const ledTeamIds = await this.ledTeamIds(userId);
    const userObjectId = new Types.ObjectId(userId);
    const [entered, played] = await Promise.all([
      this.invitationModel.distinct('tournament', {
        kind: InvitationKind.TOURNAMENT_INVITE,
        team: { $in: ledTeamIds },
        status: {
          $in: [InvitationStatus.PENDING, InvitationStatus.ACCEPTED],
        },
      }),
      this.teamMatchModel.distinct('tournamentId', {
        tournamentId: { $exists: true },
        associatedUserIds: userObjectId,
      }),
    ]);
    const filter: Record<string, unknown> = {
      $or: [
        { organizerIds: userObjectId },
        {
          organizerUserId: userObjectId,
          $or: [
            { organizerIds: { $exists: false } },
            { organizerIds: { $size: 0 } },
          ],
        },
        { _id: { $in: [...entered, ...played] } },
      ],
    };
    if (query.status?.length) {
      filter.status = { $in: query.status };
    }
    if (query.sportType) {
      filter.sportType = query.sportType;
    }
    return this.paginate(filter, query.page, query.limit);
  }

  async actingTeams(userId: string) {
    const ids = await this.ledTeamIds(userId);
    return this.teamModel
      .find({
        _id: { $in: ids },
        sportType: SportType.CRICKET,
        status: TeamStatus.ACTIVE,
      })
      .select(TEAM_SUMMARY)
      .sort({ name: 1 })
      .lean();
  }

  async getOne(tournamentId: string): Promise<TournamentDocument> {
    const tournament = await requireTournament(this.tournamentModel, tournamentId);
    return this.withOrganizers(tournament);
  }

  async addOrganizer(
    userId: string,
    tournamentId: string,
    dto: AddOrganizerDto,
  ): Promise<TournamentDocument> {
    const tournament = await requireOrganizer(
      this.tournamentModel,
      tournamentId,
      userId,
    );
    const target = await this.usersService.findById(dto.userId);
    if (!target) {
      throw new NotFoundException('User not found');
    }
    const current = organizerIdList(tournament);
    if (current.includes(resolveId(dto.userId))) {
      throw new ConflictException('User is already an organizer');
    }
    tournament.organizerIds = [...current, resolveId(dto.userId)].map(
      (id) => new Types.ObjectId(id),
    );
    await tournament.save();
    return this.withOrganizers(tournament);
  }

  async removeOrganizer(
    userId: string,
    tournamentId: string,
    targetUserId: string,
  ): Promise<TournamentDocument> {
    const tournament = await requireOrganizer(
      this.tournamentModel,
      tournamentId,
      userId,
    );
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException('Invalid user id');
    }
    if (resolveId(targetUserId) === resolveId(tournament.organizerUserId)) {
      throw new ForbiddenException('Cannot remove the original organizer');
    }
    const current = organizerIdList(tournament);
    if (!current.includes(resolveId(targetUserId))) {
      throw new NotFoundException('User is not an organizer');
    }
    const next = current.filter((id) => id !== resolveId(targetUserId));
    if (next.length === 0) {
      throw new BadRequestException('Tournament must keep at least one organizer');
    }
    tournament.organizerIds = next.map((id) => new Types.ObjectId(id));
    await tournament.save();
    return this.withOrganizers(tournament);
  }

  async listFixtures(tournamentId: string) {
    const tournament = await requireTournament(this.tournamentModel, tournamentId);
    if (
      tournament.status === TournamentStatus.SCHEDULED ||
      tournament.status === TournamentStatus.ONGOING ||
      tournament.status === TournamentStatus.COMPLETED
    ) {
      await this.drawService.sync(tournamentId);
    }
    return this.teamMatchModel
      .find({ tournamentId: tournament._id })
      .populate('fromTeam', TEAM_SUMMARY)
      .populate('toTeam', TEAM_SUMMARY)
      .populate('winnerTeam', 'name shortName')
      .populate('tournamentBracketWinner', 'name shortName')
      .sort({ matchNumber: 1 })
      .exec();
  }

  async getTable(tournamentId: string) {
    const tournament = await requireTournament(this.tournamentModel, tournamentId);
    if (
      tournament.status === TournamentStatus.SCHEDULED ||
      tournament.status === TournamentStatus.ONGOING ||
      tournament.status === TournamentStatus.COMPLETED
    ) {
      await this.drawService.sync(tournamentId);
    }
    const table = await this.drawService.buildTable(tournament);
    const teamIds = [
      ...new Set(
        table.standings.flatMap((group) =>
          group.rows.map((row) => row.teamId),
        ),
      ),
    ];
    const teams = await this.teamModel
      .find({ _id: { $in: teamIds } })
      .select(TEAM_SUMMARY)
      .lean();
    const names = new Map(teams.map((team) => [team._id.toString(), team]));
    return {
      ...table,
      standings: table.standings.map((group) => ({
        ...group,
        rows: group.rows.map((row) => ({
          ...row,
          team: names.get(row.teamId) ?? { _id: row.teamId },
        })),
      })),
    };
  }

  async lockRoster(
    userId: string,
    tournamentId: string,
  ): Promise<TournamentDocument> {
    const tournament = await requireOrganizer(
      this.tournamentModel,
      tournamentId,
      userId,
    );
    if (tournament.status !== TournamentStatus.INVITING) {
      throw new BadRequestException('The roster can only be locked while inviting');
    }
    if (isTournamentRosterLocked(tournament)) {
      throw new BadRequestException('The roster is already locked');
    }
    const accepted = await this.invitationModel.countDocuments({
      kind: InvitationKind.TOURNAMENT_INVITE,
      tournament: tournament._id,
      status: InvitationStatus.ACCEPTED,
    });
    if (accepted < 1) {
      throw new BadRequestException('Accept at least one team before locking');
    }
    assertTournamentSize(tournament.format, accepted);
    tournament.maxTeams = accepted;
    tournament.rosterLockedAt = new Date();
    if (tournament.format === TournamentFormat.HYBRID) {
      tournament.advanceCount = hybridKnockoutBracketSize(accepted);
      tournament.groupSize = undefined;
    }
    await tournament.save();
    await this.declinePendingEntries(tournament, userId);
    return tournament;
  }

  async removeAcceptedTeam(
    userId: string,
    tournamentId: string,
    invitationId: string,
  ) {
    const tournament = await requireOrganizer(
      this.tournamentModel,
      tournamentId,
      userId,
    );
    if (tournament.status !== TournamentStatus.INVITING) {
      throw new BadRequestException('Teams can only be removed while inviting');
    }
    if (isTournamentRosterLocked(tournament)) {
      throw new BadRequestException('Unlock is not supported; roster is locked');
    }
    const invitation = await requireForTournament(
      this.invitationModel,
      tournament._id,
      invitationId,
    );
    if (invitation.status !== InvitationStatus.ACCEPTED) {
      throw new BadRequestException('Only an accepted team can be removed');
    }
    invitation.status = InvitationStatus.DECLINED;
    invitation.decidedAt = new Date();
    invitation.decidedBy = new Types.ObjectId(userId);
    await invitation.save();
    const team = await this.teamService.requireTeam(resolveId(invitation.team));
    await notifyEntryDecision(
      this.notificationService,
      this.teamMemberModel,
      {
        kind: 'tournament_request_declined',
        title: 'Removed from tournament',
        body: `${team.name} was removed from ${tournament.name}.`,
        tournamentId: tournament._id.toString(),
        invitationId: invitation._id.toString(),
        actorUserId: userId,
        team,
      },
    );
    return invitation.populate('team', TEAM_SUMMARY);
  }

  async generateDraw(userId: string, tournamentId: string) {
    const tournament = await requireOrganizer(this.tournamentModel, tournamentId, userId);
    if (tournament.status !== TournamentStatus.INVITING) {
      throw new BadRequestException('The draw can only be made while inviting');
    }
    if (!isTournamentRosterLocked(tournament) || tournament.maxTeams == null) {
      throw new BadRequestException('Lock the roster before generating the draw');
    }
    assertTournamentSize(tournament.format, tournament.maxTeams);
    const entries = await this.invitationModel
      .find({
        kind: InvitationKind.TOURNAMENT_INVITE,
        tournament: tournament._id,
        status: InvitationStatus.ACCEPTED,
      })
      .sort({ acceptedAt: 1, _id: 1 })
      .exec();
    if (entries.length !== tournament.maxTeams) {
      throw new BadRequestException(
        `Accepted teams (${entries.length}) must match the locked roster (${tournament.maxTeams})`,
      );
    }

    const teamIds = entries.map((entry) => resolveId(entry.team));
    const plans =
      tournament.format === TournamentFormat.KNOCKOUT
        ? knockoutFullBracketPlans(teamIds)
        : openingFixturePlans(tournament.format, teamIds);
    await this.teamMatchModel.insertMany(
      plans.map((plan) => ({
        source: TeamMatchSource.RANKED,
        ...(plan.fromTeamId
          ? { fromTeam: new Types.ObjectId(plan.fromTeamId) }
          : {}),
        ...(plan.toTeamId
          ? { toTeam: new Types.ObjectId(plan.toTeamId) }
          : {}),
        sportType: tournament.sportType,
        status: TeamMatchStatus.SCHEDULE_FINALIZED,
        tournamentId: tournament._id,
        stage: plan.stage,
        round: plan.round,
        matchNumber: plan.matchNumber,
        ...(plan.groupLabel ? { groupLabel: plan.groupLabel } : {}),
        ...(plan.sourceMatchNumbers
          ? { sourceMatchNumbers: plan.sourceMatchNumbers }
          : {}),
        statusUpdatedAt: new Date(),
        statusUpdatedBy: new Types.ObjectId(userId),
      })),
    );

    await this.declinePendingEntries(tournament, userId, {
      title: 'Tournament closed',
      body: `${tournament.name} has locked its draw.`,
    });

    tournament.status = TournamentStatus.SCHEDULED;
    return tournament.save();
  }

  async pickBracketWinner(
    userId: string,
    tournamentId: string,
    matchId: string,
    dto: BracketWinnerDto,
  ) {
    const tournament = await requireOrganizer(this.tournamentModel, tournamentId, userId);
    const match = await this.teamMatchModel.findOne({
      _id: matchId,
      tournamentId: tournament._id,
    });
    if (!match) {
      throw new NotFoundException('Fixture not found');
    }
    if (match.stage !== 'knockout') {
      throw new BadRequestException('Only a knockout fixture can be picked');
    }
    if (match.status !== TeamMatchStatus.DRAW) {
      throw new BadRequestException('Pick a winner only when the match is a draw');
    }
    const fromTeamId = resolveIdOrNull(match.fromTeam);
    const toTeamId = resolveIdOrNull(match.toTeam);
    if (!fromTeamId || !toTeamId) {
      throw new BadRequestException(
        'Both teams must be set before this match can be played',
      );
    }
    const sideIds = [fromTeamId, toTeamId];
    if (!sideIds.includes(dto.teamId)) {
      throw new BadRequestException('That team is not in this fixture');
    }
    match.tournamentBracketWinner = new Types.ObjectId(dto.teamId);
    await match.save();
    await this.drawService.sync(tournament._id.toString());
    return match;
  }

  async updateFixtureTeams(
    userId: string,
    tournamentId: string,
    matchId: string,
    dto: UpdateFixtureTeamsDto,
  ) {
    const tournament = await requireOrganizer(
      this.tournamentModel,
      tournamentId,
      userId,
    );
    const match = await this.teamMatchModel.findOne({
      _id: matchId,
      tournamentId: tournament._id,
    });
    if (!match) {
      throw new NotFoundException('Fixture not found');
    }
    const league = match.stage === TournamentStage.LEAGUE;
    if (match.stage !== TournamentStage.KNOCKOUT && !league) {
      throw new BadRequestException(
        'Only a league or knockout fixture can be edited',
      );
    }
    if (!isUnstartedFixture(match)) {
      throw new BadRequestException(
        'Only a match that has not started can be edited',
      );
    }

    const matches = await this.teamMatchModel
      .find({ tournamentId: tournament._id })
      .exec();
    if (!league) {
      const byNumber = new Map(
        matches
          .filter((item) => item.matchNumber != null)
          .map((item) => [item.matchNumber as number, item]),
      );
      const sources = [...(match.sourceMatchNumbers ?? [])].sort(
        (left, right) => left - right,
      );
      assertFeederSideStillOpen(dto.fromTeamId, sources[0], 'fromTeam', match, byNumber);
      assertFeederSideStillOpen(dto.toTeamId, sources[1], 'toTeam', match, byNumber);
    }

    const nextFrom =
      dto.fromTeamId !== undefined
        ? dto.fromTeamId
        : resolveIdOrNull(match.fromTeam);
    const nextTo =
      dto.toTeamId !== undefined
        ? dto.toTeamId
        : resolveIdOrNull(match.toTeam);
    if (nextFrom && nextTo && nextFrom === nextTo) {
      throw new BadRequestException('A match needs two different teams');
    }

    const accepted = await this.invitationModel
      .find({
        kind: InvitationKind.TOURNAMENT_INVITE,
        tournament: tournament._id,
        status: InvitationStatus.ACCEPTED,
      })
      .exec();
    const allowed = new Set(accepted.map((entry) => resolveId(entry.team)));
    for (const teamId of [nextFrom, nextTo]) {
      if (teamId && !allowed.has(teamId)) {
        throw new BadRequestException('That team is not in this tournament');
      }
    }

    if (!league) {
      const occupied = new Set<string>();
      for (const other of matches) {
        if (other._id.equals(match._id)) {
          continue;
        }
        if (other.stage !== TournamentStage.KNOCKOUT || other.round !== match.round) {
          continue;
        }
        if (ROUND_SLOT_FREE.has(other.status)) {
          continue;
        }
        const home = resolveIdOrNull(other.fromTeam);
        const away = resolveIdOrNull(other.toTeam);
        if (home) occupied.add(home);
        if (away) occupied.add(away);
      }
      if (nextFrom && occupied.has(nextFrom)) {
        throw new ConflictException(
          'That team is already in another match this round',
        );
      }
      if (nextTo && occupied.has(nextTo)) {
        throw new ConflictException(
          'That team is already in another match this round',
        );
      }

      if (match.matchNumber != null) {
        const fed = matchesFedBy(match.matchNumber, matches);
        if (fed.some(({ match: child }) => !isUnstartedFixture(child))) {
          throw new BadRequestException(
            'This match cannot be edited because a later match has already started',
          );
        }
      }
    }

    if (dto.fromTeamId !== undefined) {
      assignFixtureSide(match, 'fromTeam', dto.fromTeamId);
    }
    if (dto.toTeamId !== undefined) {
      assignFixtureSide(match, 'toTeam', dto.toTeamId);
    }
    match.tournamentBracketWinner = undefined;
    await match.save();
    if (!league && match.matchNumber != null) {
      await this.drawService.clearUnstartedFeederSides(
        tournament._id.toString(),
        match.matchNumber,
      );
    }
    return match.populate([
      { path: 'fromTeam', select: TEAM_SUMMARY },
      { path: 'toTeam', select: TEAM_SUMMARY },
    ]);
  }

  async pickQualifiers(
    userId: string,
    tournamentId: string,
    dto: QualifierPickDto,
  ) {
    const tournament = await requireOrganizer(this.tournamentModel, tournamentId, userId);
    if (tournament.format !== TournamentFormat.HYBRID) {
      throw new BadRequestException('Only a hybrid tournament needs a qualifier pick');
    }
    const table = await this.drawService.buildTable(tournament);
    const group = table.standings.find(
      (item) => (item.groupLabel ?? '') === dto.groupLabel,
    );
    if (!group?.advance?.pending) {
      throw new BadRequestException(
        'This group does not need a qualifier pick',
      );
    }
    const maxTeams = requireTournamentMaxTeams(tournament);
    const advanceCount =
      tournament.advanceCount ?? hybridKnockoutBracketSize(maxTeams);
    if (dto.teamIds.length !== advanceCount) {
      throw new BadRequestException(`Pick ${advanceCount} teams`);
    }
    const allowed = new Set([
      ...group.advance.lockedTeamIds,
      ...group.advance.tiedTeamIds,
    ]);
    if (dto.teamIds.some((id) => !allowed.has(id))) {
      throw new BadRequestException('Pick teams from the tied group');
    }
    tournament.manualQualifiers = tournament.manualQualifiers.filter(
      (item) => item.groupLabel !== dto.groupLabel,
    );
    tournament.manualQualifiers.push({
      groupLabel: dto.groupLabel,
      teamIds: dto.teamIds.map((id) => new Types.ObjectId(id)),
    });
    await tournament.save();
    const refreshed = await this.drawService.buildTable(tournament);
    const stillPending = refreshed.standings.find(
      (item) => item.groupLabel === dto.groupLabel,
    )?.advance?.pending;
    if (stillPending) {
      tournament.manualQualifiers = tournament.manualQualifiers.filter(
        (item) => item.groupLabel !== dto.groupLabel,
      );
      await tournament.save();
      throw new BadRequestException(
        'That pick does not split the qualifier tie',
      );
    }
    await this.drawService.sync(tournament._id.toString());
    return tournament;
  }

  async onMatchUpdated(match: TeamMatchDocument): Promise<void> {
    await this.snapshotMatchRoster(match);
    await this.drawService.syncFromMatch(match);
  }

  async onMatchReopened(match: TeamMatchDocument): Promise<void> {
    if (!match.tournamentId) {
      return;
    }
    if (match.matchNumber != null) {
      await this.drawService.clearUnstartedFeederSides(
        resolveId(match.tournamentId),
        match.matchNumber,
      );
    }
    await this.drawService.sync(resolveId(match.tournamentId));
  }

  /**
   * Freeze both teams' owners and active members onto the fixture the first time it is played.
   */
  private async snapshotMatchRoster(match: TeamMatchDocument): Promise<void> {
    if (match.associatedUserIds?.length) {
      return;
    }
    if (
      match.status !== TeamMatchStatus.ONGOING &&
      match.status !== TeamMatchStatus.COMPLETED &&
      match.status !== TeamMatchStatus.DRAW
    ) {
      return;
    }
    if (!resolveIdOrNull(match.fromTeam) || !resolveIdOrNull(match.toTeam)) {
      return;
    }

    const teamIds = [resolveId(match.fromTeam), resolveId(match.toTeam)].map(
      (id) => new Types.ObjectId(id),
    );
    const [teams, members] = await Promise.all([
      this.teamModel.find({ _id: { $in: teamIds } }).select('ownerIds').lean(),
      this.teamMemberModel
        .find({
          team: { $in: teamIds },
          status: TeamMemberStatus.ACTIVE,
        })
        .select('user')
        .lean(),
    ]);

    const ids = new Set<string>();
    for (const team of teams) {
      for (const ownerId of team.ownerIds ?? []) {
        ids.add(resolveId(ownerId));
      }
    }
    for (const member of members) {
      ids.add(resolveId(member.user));
    }
    if (!ids.size) {
      return;
    }

    await this.teamMatchModel.updateOne(
      {
        _id: match._id,
        $or: [
          { associatedUserIds: { $exists: false } },
          { associatedUserIds: { $size: 0 } },
        ],
      },
      {
        $set: {
          associatedUserIds: [...ids].map((id) => new Types.ObjectId(id)),
        },
      },
    );
  }

  private async paginate(
    filter: Record<string, unknown>,
    page: number,
    limit: number,
  ) {
    const [items, total] = await Promise.all([
      this.tournamentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(ORGANIZER_POPULATE)
        .exec(),
      this.tournamentModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  private async withOrganizers(
    tournament: TournamentDocument,
  ): Promise<TournamentDocument> {
    const seeded = !tournament.organizerIds?.length && !!tournament.organizerUserId;
    if (seeded) {
      tournament.organizerIds = [tournament.organizerUserId];
    }
    await tournament.populate(ORGANIZER_POPULATE);
    if (seeded) {
      tournament.unmarkModified('organizerIds');
    }
    return tournament;
  }

  private async declinePendingEntries(
    tournament: TournamentDocument,
    userId: string,
    copy?: { title: string; body: string },
  ): Promise<void> {
    const pending = await this.invitationModel
      .find({
        kind: InvitationKind.TOURNAMENT_INVITE,
        tournament: tournament._id,
        status: InvitationStatus.PENDING,
      })
      .exec();
    if (!pending.length) {
      return;
    }
    await this.invitationModel.updateMany(
      { _id: { $in: pending.map((entry) => entry._id) } },
      {
        $set: {
          status: InvitationStatus.DECLINED,
          decidedAt: new Date(),
          decidedBy: new Types.ObjectId(userId),
        },
      },
    );
    for (const entry of pending) {
      const team = await this.teamService.requireTeam(resolveId(entry.team));
      const kind =
        entry.direction === TournamentInvitationDirection.INVITE
          ? 'tournament_invite_declined'
          : 'tournament_request_declined';
      await notifyEntryDecision(
        this.notificationService,
        this.teamMemberModel,
        {
          kind,
          title: copy?.title ?? 'Registration closed',
          body:
            copy?.body ??
            `${tournament.name} is no longer accepting teams.`,
          tournamentId: tournament._id.toString(),
          invitationId: entry._id.toString(),
          actorUserId: userId,
          team,
        },
      );
    }
  }

  private async ledTeamIds(userId: string): Promise<Types.ObjectId[]> {
    const owned = await this.teamModel.distinct('_id', {
      ownerIds: new Types.ObjectId(userId),
      status: TeamStatus.ACTIVE,
    });
    const leadership = await this.teamMemberModel.distinct('team', {
      user: new Types.ObjectId(userId),
      status: TeamMemberStatus.ACTIVE,
      leadershipRole: {
        $in: [LeadershipRole.CAPTAIN, LeadershipRole.VICE_CAPTAIN],
      },
    });
    const ids = new Map<string, Types.ObjectId>();
    for (const id of [...owned, ...leadership]) {
      ids.set(id.toString(), new Types.ObjectId(id.toString()));
    }
    return [...ids.values()];
  }
}
