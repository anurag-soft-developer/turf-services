import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { resolveId } from '../../core/utils/mongo-ref.util';
import { assertCanActForTeam } from '../../matchmaking/util/matchmaking.helpers';
import { NotificationService } from '../../notification/notification.service';
import { TeamMember } from '../../team-member/schemas/team-member.schema';
import { TeamMemberService } from '../../team-member/team-member.service';
import { TeamService } from '../../team/team.service';
import { Tournament, TournamentDocument } from '../../tournament/schemas/tournament.schema';
import { TournamentStatus } from '../../tournament/tournament.constants';
import {
  assertJoinOpen,
  assertOrganizer,
  organizerIdList,
  requireCricketTeam,
  requireOrganizer,
  requireTournament,
} from '../../tournament/util/tournament-asserts.util';
import { isTournamentRosterLocked } from '../../tournament/util/tournament-entry.util';
import {
  notifyEntryDecision,
  notifyTournamentInvite,
  notifyTournamentRequest,
} from '../../tournament/util/tournament-notification.utility';
import {
  InvitationKind,
  InvitationStatus,
  TournamentInvitationDirection,
} from '../invitation.constants';
import { Invitation, InvitationDocument } from '../schemas/invitation.schema';
import {
  assertNoLiveTournamentInvitation,
  assertPending,
  requireForTournament,
} from '../shared/invitation-asserts.util';
import { paginateInvitations } from '../shared/invitation-query.util';
import {
  CreateTournamentInvitationDto,
  ListTournamentInvitationsDto,
} from './dto/tournament-invite.dto';

const TEAM_SUMMARY = 'name shortName logo sportType location';

@Injectable()
export class TournamentInviteService {
  constructor(
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<InvitationDocument>,
    @InjectModel(Tournament.name)
    private readonly tournamentModel: Model<TournamentDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMember>,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
    private readonly notificationService: NotificationService,
  ) {}

  async create(
    userId: string,
    tournamentId: string,
    dto: CreateTournamentInvitationDto,
  ) {
    if (dto.direction === TournamentInvitationDirection.INVITE) {
      return this.invite(userId, tournamentId, dto.teamId);
    }
    return this.requestToJoin(userId, tournamentId, dto.teamId);
  }

  async list(tournamentId: string, query: ListTournamentInvitationsDto) {
    await requireTournament(this.tournamentModel, tournamentId);
    const filter: Record<string, unknown> = {
      kind: InvitationKind.TOURNAMENT_INVITE,
      tournament: tournamentId,
    };
    if (query.status) filter.status = query.status;
    if (query.direction) filter.direction = query.direction;
    return paginateInvitations(
      this.invitationModel,
      filter,
      query.page,
      query.limit,
      {
        path: 'team',
        select: TEAM_SUMMARY,
      },
    );
  }

  async accept(userId: string, tournamentId: string, invitationId: string) {
    const tournament = await requireTournament(this.tournamentModel, tournamentId);
    const invitation = await requireForTournament(
      this.invitationModel,
      tournament._id,
      invitationId,
    );
    if (invitation.direction === TournamentInvitationDirection.REQUEST) {
      return this.acceptRequest(userId, tournament, invitation);
    }
    return this.acceptInvite(userId, tournament, invitation);
  }

  async decline(userId: string, tournamentId: string, invitationId: string) {
    const tournament = await requireTournament(this.tournamentModel, tournamentId);
    const invitation = await requireForTournament(
      this.invitationModel,
      tournament._id,
      invitationId,
    );
    if (invitation.direction === TournamentInvitationDirection.REQUEST) {
      return this.declineRequest(userId, tournament, invitation);
    }
    return this.declineInvite(userId, tournament, invitation);
  }

  async revoke(userId: string, tournamentId: string, invitationId: string) {
    const tournament = await requireOrganizer(
      this.tournamentModel,
      tournamentId,
      userId,
    );
    if (isTournamentRosterLocked(tournament)) {
      throw new BadRequestException('The roster is locked');
    }
    const invitation = await requireForTournament(
      this.invitationModel,
      tournament._id,
      invitationId,
    );
    this.assertDirection(invitation, TournamentInvitationDirection.INVITE);
    assertPending(invitation);
    const team = await requireCricketTeam(
      this.teamService,
      resolveId(invitation.team),
      tournament.sportType,
    );
    const invitationIdStr = invitation._id.toString();
    await notifyEntryDecision(
      this.notificationService,
      this.teamMemberModel,
      {
        kind: 'tournament_invite_declined',
        title: 'Invite cancelled',
        body: `${tournament.name} withdrew your invite.`,
        tournamentId: tournament._id.toString(),
        invitationId: invitationIdStr,
        actorUserId: userId,
        team,
      },
    );
    await invitation.deleteOne();
    return { success: true, _id: invitationIdStr };
  }

  async withdraw(userId: string, tournamentId: string, invitationId: string) {
    const tournament = await requireTournament(this.tournamentModel, tournamentId);
    const invitation = await requireForTournament(
      this.invitationModel,
      tournament._id,
      invitationId,
    );
    this.assertDirection(invitation, TournamentInvitationDirection.REQUEST);
    assertPending(invitation);
    const team = await requireCricketTeam(
      this.teamService,
      resolveId(invitation.team),
      tournament.sportType,
    );
    await assertCanActForTeam(
      team,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    const invitationIdStr = invitation._id.toString();
    await notifyEntryDecision(
      this.notificationService,
      this.teamMemberModel,
      {
        kind: 'tournament_request_withdrawn',
        title: 'Request withdrawn',
        body: `${team.name} withdrew from ${tournament.name}.`,
        tournamentId: tournament._id.toString(),
        invitationId: invitationIdStr,
        actorUserId: userId,
        organizerUserIds: organizerIdList(tournament),
      },
    );
    await invitation.deleteOne();
    return { success: true, _id: invitationIdStr };
  }

  private async invite(userId: string, tournamentId: string, teamId: string) {
    const tournament = await requireOrganizer(
      this.tournamentModel,
      tournamentId,
      userId,
    );
    await assertJoinOpen(this.invitationModel, tournament);
    const team = await requireCricketTeam(
      this.teamService,
      teamId,
      tournament.sportType,
    );
    await assertNoLiveTournamentInvitation(
      this.invitationModel,
      tournament._id,
      team._id,
    );
    const invitation = await this.invitationModel.create({
      kind: InvitationKind.TOURNAMENT_INVITE,
      tournament: tournament._id,
      team: team._id,
      direction: TournamentInvitationDirection.INVITE,
      status: InvitationStatus.PENDING,
      invitedBy: new Types.ObjectId(userId),
    });
    await notifyTournamentInvite(
      this.notificationService,
      this.teamMemberModel,
      {
        team,
        tournamentId: tournament._id.toString(),
        tournamentName: tournament.name,
        invitationId: invitation._id.toString(),
        actorUserId: userId,
      },
    );
    return invitation.populate('team', TEAM_SUMMARY);
  }

  private async requestToJoin(
    userId: string,
    tournamentId: string,
    teamId: string,
  ) {
    const tournament = await requireTournament(this.tournamentModel, tournamentId);
    await assertJoinOpen(this.invitationModel, tournament);
    const team = await requireCricketTeam(
      this.teamService,
      teamId,
      tournament.sportType,
    );
    await assertCanActForTeam(
      team,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    await assertNoLiveTournamentInvitation(
      this.invitationModel,
      tournament._id,
      team._id,
    );
    const invitation = await this.invitationModel.create({
      kind: InvitationKind.TOURNAMENT_INVITE,
      tournament: tournament._id,
      team: team._id,
      direction: TournamentInvitationDirection.REQUEST,
      status: InvitationStatus.PENDING,
      invitedBy: new Types.ObjectId(userId),
    });
    await notifyTournamentRequest(this.notificationService, {
      organizerUserIds: organizerIdList(tournament),
      teamName: team.name,
      tournamentId: tournament._id.toString(),
      tournamentName: tournament.name,
      invitationId: invitation._id.toString(),
      actorUserId: userId,
    });
    return invitation.populate('team', TEAM_SUMMARY);
  }

  private async acceptInvite(
    userId: string,
    tournament: TournamentDocument,
    invitation: InvitationDocument,
  ) {
    this.assertDirection(invitation, TournamentInvitationDirection.INVITE);
    const team = await requireCricketTeam(
      this.teamService,
      resolveId(invitation.team),
      tournament.sportType,
    );
    await assertCanActForTeam(
      team,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    await this.acceptInvitation(tournament, invitation, userId);
    await notifyEntryDecision(
      this.notificationService,
      this.teamMemberModel,
      {
        kind: 'tournament_invite_accepted',
        title: 'Invite accepted',
        body: `${team.name} joined ${tournament.name}.`,
        tournamentId: tournament._id.toString(),
        invitationId: invitation._id.toString(),
        actorUserId: userId,
        organizerUserIds: organizerIdList(tournament),
      },
    );
    return invitation.populate('team', TEAM_SUMMARY);
  }

  private async declineInvite(
    userId: string,
    tournament: TournamentDocument,
    invitation: InvitationDocument,
  ) {
    this.assertDirection(invitation, TournamentInvitationDirection.INVITE);
    const team = await requireCricketTeam(
      this.teamService,
      resolveId(invitation.team),
      tournament.sportType,
    );
    await assertCanActForTeam(
      team,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    assertPending(invitation);
    const invitationIdStr = invitation._id.toString();
    await notifyEntryDecision(
      this.notificationService,
      this.teamMemberModel,
      {
        kind: 'tournament_invite_declined',
        title: 'Invite declined',
        body: `${team.name} declined ${tournament.name}.`,
        tournamentId: tournament._id.toString(),
        invitationId: invitationIdStr,
        actorUserId: userId,
        organizerUserIds: organizerIdList(tournament),
      },
    );
    await invitation.deleteOne();
    return { success: true, _id: invitationIdStr };
  }

  private async acceptRequest(
    userId: string,
    tournament: TournamentDocument,
    invitation: InvitationDocument,
  ) {
    assertOrganizer(tournament, userId);
    this.assertDirection(invitation, TournamentInvitationDirection.REQUEST);
    const team = await requireCricketTeam(
      this.teamService,
      resolveId(invitation.team),
      tournament.sportType,
    );
    await this.acceptInvitation(tournament, invitation, userId);
    await notifyEntryDecision(
      this.notificationService,
      this.teamMemberModel,
      {
        kind: 'tournament_request_accepted',
        title: 'Request accepted',
        body: `${team.name} is in ${tournament.name}.`,
        tournamentId: tournament._id.toString(),
        invitationId: invitation._id.toString(),
        actorUserId: userId,
        team,
      },
    );
    return invitation.populate('team', TEAM_SUMMARY);
  }

  /**
   * Adds a team from an accepted opening enrollment.
   * Accepts a pending request when one exists, otherwise writes an accepted request.
   */
  async recordAcceptedRequest(
    userId: string,
    tournamentId: string,
    teamId: string,
  ) {
    const tournament = await requireTournament(
      this.tournamentModel,
      tournamentId,
    );
    assertOrganizer(tournament, userId);
    const team = await requireCricketTeam(
      this.teamService,
      teamId,
      tournament.sportType,
    );
    const existing = await this.invitationModel.findOne({
      kind: InvitationKind.TOURNAMENT_INVITE,
      tournament: tournament._id,
      team: team._id,
      status: { $in: [InvitationStatus.PENDING, InvitationStatus.ACCEPTED] },
    });
    if (existing?.status === InvitationStatus.ACCEPTED) {
      return existing;
    }
    if (
      existing?.status === InvitationStatus.PENDING &&
      existing.direction === TournamentInvitationDirection.REQUEST
    ) {
      await this.acceptInvitation(tournament, existing, userId);
      await notifyEntryDecision(
        this.notificationService,
        this.teamMemberModel,
        {
          kind: 'tournament_request_accepted',
          title: 'Request accepted',
          body: `${team.name} is in ${tournament.name}.`,
          tournamentId: tournament._id.toString(),
          invitationId: existing._id.toString(),
          actorUserId: userId,
          team,
        },
      );
      return existing;
    }
    if (existing) {
      throw new ConflictException(
        'This team already has a live entry in the tournament',
      );
    }
    if (tournament.status !== TournamentStatus.INVITING) {
      throw new BadRequestException('Entries are closed');
    }
    if (isTournamentRosterLocked(tournament)) {
      throw new BadRequestException('The roster is locked');
    }
    const accepted = await this.invitationModel.countDocuments({
      kind: InvitationKind.TOURNAMENT_INVITE,
      tournament: tournament._id,
      status: InvitationStatus.ACCEPTED,
    });
    if (tournament.maxTeams != null && accepted >= tournament.maxTeams) {
      throw new BadRequestException('This tournament is full');
    }
    const invitation = await this.invitationModel.create({
      kind: InvitationKind.TOURNAMENT_INVITE,
      tournament: tournament._id,
      team: team._id,
      direction: TournamentInvitationDirection.REQUEST,
      status: InvitationStatus.ACCEPTED,
      invitedBy: new Types.ObjectId(userId),
      acceptedAt: new Date(),
      decidedAt: new Date(),
      decidedBy: new Types.ObjectId(userId),
    });
    await notifyEntryDecision(this.notificationService, this.teamMemberModel, {
      kind: 'tournament_request_accepted',
      title: 'Request accepted',
      body: `${team.name} is in ${tournament.name}.`,
      tournamentId: tournament._id.toString(),
      invitationId: invitation._id.toString(),
      actorUserId: userId,
      team,
    });
    return invitation;
  }

  private async declineRequest(
    userId: string,
    tournament: TournamentDocument,
    invitation: InvitationDocument,
  ) {
    assertOrganizer(tournament, userId);
    this.assertDirection(invitation, TournamentInvitationDirection.REQUEST);
    const team = await requireCricketTeam(
      this.teamService,
      resolveId(invitation.team),
      tournament.sportType,
    );
    assertPending(invitation);
    const invitationIdStr = invitation._id.toString();
    await notifyEntryDecision(
      this.notificationService,
      this.teamMemberModel,
      {
        kind: 'tournament_request_declined',
        title: 'Request declined',
        body: `${team.name} was not added to ${tournament.name}.`,
        tournamentId: tournament._id.toString(),
        invitationId: invitationIdStr,
        actorUserId: userId,
        team,
      },
    );
    await invitation.deleteOne();
    return { success: true, _id: invitationIdStr };
  }

  private assertDirection(
    invitation: InvitationDocument,
    direction: TournamentInvitationDirection,
  ): void {
    if (invitation.direction !== direction) {
      throw new BadRequestException('This invitation cannot be updated that way');
    }
  }

  private async acceptInvitation(
    tournament: TournamentDocument,
    invitation: InvitationDocument,
    userId: string,
  ) {
    if (tournament.status !== TournamentStatus.INVITING) {
      throw new BadRequestException('Entries are closed');
    }
    assertPending(invitation);
    const accepted = await this.invitationModel.countDocuments({
      kind: InvitationKind.TOURNAMENT_INVITE,
      tournament: tournament._id,
      status: InvitationStatus.ACCEPTED,
    });
    if (tournament.maxTeams != null && accepted >= tournament.maxTeams) {
      throw new BadRequestException('This tournament is full');
    }
    if (isTournamentRosterLocked(tournament)) {
      throw new BadRequestException('The roster is locked');
    }
    invitation.status = InvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    invitation.decidedAt = new Date();
    invitation.decidedBy = new Types.ObjectId(userId);
    await invitation.save();
  }
}
