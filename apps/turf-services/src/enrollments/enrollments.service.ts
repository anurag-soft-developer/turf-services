import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResult } from '../core/interfaces/common';
import { assertCanActForTeam } from '../matchmaking/util/matchmaking.helpers';
import { NotificationService } from '../notification/notification.service';
import {
  Opening,
  OpeningDocument,
  OpeningStatus,
  OpeningType,
} from '../openings/schemas/opening.schema';
import { OpeningsService } from '../openings/openings.service';
import {
  HostSnapshot,
  teamSnapshot,
  tournamentSnapshot,
} from '../openings/util/opening-host.util';
import { TeamMemberService } from '../team-member/team-member.service';
import {
  notifyTeamJoinRequest,
  notifyTeamJoinResolved,
} from '../team-member/utility/team-member-notification.utility';
import { Team, TeamDocument } from '../team/schemas/team.schema';
import { TeamService } from '../team/team.service';
import {
  Tournament,
  TournamentDocument,
} from '../tournament/schemas/tournament.schema';
import { requireCricketTeam } from '../tournament/util/tournament-asserts.util';
import { TournamentInviteService } from '../invitations/tournament-invite/tournament-invite.service';
import { assertNoLiveTournamentInvitation } from '../invitations/shared/invitation-asserts.util';
import { Invitation, InvitationDocument } from '../invitations/schemas/invitation.schema';
import { userSelectFields } from '../users/schemas/user.schema';
import { EnrollDto, EnrollmentListDto } from './dto/enrollment.dto';
import {
  Enrollment,
  EnrollmentDocument,
  EnrollmentStatus,
} from './schemas/enrollment.schema';
import {
  assertObjectId,
  EnrollmentView,
  hostId,
  isDuplicateKey,
  subjectKey,
  toEnrollmentView,
} from './util/enrollment.util';

export type { EnrollmentView };

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(Opening.name)
    private readonly openingModel: Model<OpeningDocument>,
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    @InjectModel(Tournament.name)
    private readonly tournamentModel: Model<TournamentDocument>,
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<InvitationDocument>,
    private readonly openingsService: OpeningsService,
    private readonly teamMemberService: TeamMemberService,
    private readonly teamService: TeamService,
    private readonly tournamentInviteService: TournamentInviteService,
    private readonly notificationService: NotificationService,
  ) {}

  async enroll(
    userId: string,
    openingId: string,
    dto: EnrollDto,
  ): Promise<EnrollmentView> {
    const opening = await this.requireOpenOpening(openingId);
    if (opening.type === OpeningType.TEAM) {
      return this.enrollInTeam(userId, opening);
    }
    if (!dto.teamId) {
      throw new BadRequestException('Choose a team to enter');
    }
    return this.enrollInTournament(userId, opening, dto.teamId);
  }

  async withdraw(
    userId: string,
    openingId: string,
    teamId?: string,
  ): Promise<void> {
    assertObjectId(openingId, 'opening');
    const filter: Record<string, unknown> = {
      openingId: new Types.ObjectId(openingId),
      user: new Types.ObjectId(userId),
      status: EnrollmentStatus.PENDING,
    };
    if (teamId) {
      assertObjectId(teamId, 'team');
      filter.teamId = new Types.ObjectId(teamId);
    }
    const rows = await this.enrollmentModel.find(filter).limit(2);
    if (rows.length === 0) {
      throw new BadRequestException('You do not have a pending enrollment');
    }
    if (rows.length > 1) {
      throw new BadRequestException('Choose a team to withdraw');
    }
    await rows[0].deleteOne();
  }

  async findMine(
    userId: string,
    query: EnrollmentListDto,
  ): Promise<PaginatedResult<EnrollmentView>> {
    assertObjectId(userId, 'user');
    const filter: Record<string, unknown> = {
      user: new Types.ObjectId(userId),
    };
    if (query.status) filter.status = query.status;
    return this.paginate(filter, query.page, query.limit);
  }

  async findForOpening(
    userId: string,
    openingId: string,
    query: EnrollmentListDto,
  ): Promise<PaginatedResult<EnrollmentView>> {
    await this.openingsService.requireManaged(userId, openingId);
    const filter: Record<string, unknown> = {
      openingId: new Types.ObjectId(openingId),
    };
    if (query.status) filter.status = query.status;
    return this.paginate(filter, query.page, query.limit);
  }

  async accept(
    userId: string,
    openingId: string,
    enrollmentId: string,
  ): Promise<EnrollmentView> {
    const { enrollment, opening } = await this.requirePendingForPoster(
      userId,
      openingId,
      enrollmentId,
    );
    if (opening.type === OpeningType.TEAM) {
      try {
        await this.teamMemberService.insertActiveMember(
          hostId(opening),
          enrollment.user.toString(),
          { reviewedBy: userId },
        );
      } catch (error) {
        const alreadyMember = await this.teamMemberService.hasActiveMembership(
          hostId(opening),
          enrollment.user.toString(),
        );
        if (!alreadyMember) throw error;
      }
      const team = await this.teamService.requireTeam(hostId(opening));
      await this.markReviewed(enrollment, userId, EnrollmentStatus.ACCEPTED);
      await notifyTeamJoinResolved(this.notificationService, {
        recipientUserId: enrollment.user.toString(),
        teamId: team._id.toString(),
        teamName: team.name,
        enrollmentId: enrollment._id.toString(),
        openingId: opening._id.toString(),
        accepted: true,
      });
    } else {
      const teamId = enrollment.teamId?.toString();
      if (!teamId) {
        throw new BadRequestException('This enrollment has no team');
      }
      await this.tournamentInviteService.recordAcceptedRequest(
        userId,
        hostId(opening),
        teamId,
      );
      await this.markReviewed(enrollment, userId, EnrollmentStatus.ACCEPTED);
    }
    return this.present(enrollment, opening);
  }

  async reject(
    userId: string,
    openingId: string,
    enrollmentId: string,
  ): Promise<EnrollmentView> {
    const { enrollment, opening } = await this.requirePendingForPoster(
      userId,
      openingId,
      enrollmentId,
    );
    await this.markReviewed(enrollment, userId, EnrollmentStatus.REJECTED);
    if (opening.type === OpeningType.TEAM) {
      const team = await this.teamService.requireTeam(hostId(opening));
      await notifyTeamJoinResolved(this.notificationService, {
        recipientUserId: enrollment.user.toString(),
        teamId: team._id.toString(),
        teamName: team.name,
        enrollmentId: enrollment._id.toString(),
        openingId: opening._id.toString(),
        accepted: false,
      });
    }
    return this.present(enrollment, opening);
  }

  private async enrollInTeam(
    userId: string,
    opening: OpeningDocument,
  ): Promise<EnrollmentView> {
    const teamId = hostId(opening);
    const pendingCount = await this.enrollmentModel.countDocuments({
      openingId: opening._id,
      status: EnrollmentStatus.PENDING,
    });
    const { team } = await this.teamMemberService.assertCanRequestJoin(
      teamId,
      userId,
      opening,
      pendingCount,
    );
    const created = await this.insertEnrollment({
      opening,
      userId,
      status: EnrollmentStatus.PENDING,
    });
    await notifyTeamJoinRequest(this.notificationService, {
      team,
      enrollmentId: created._id.toString(),
      openingId: opening._id.toString(),
      requesterUserId: userId,
    });
    return this.present(created, opening);
  }

  private async enrollInTournament(
    userId: string,
    opening: OpeningDocument,
    teamId: string,
  ): Promise<EnrollmentView> {
    assertObjectId(teamId, 'team');
    const team = await requireCricketTeam(
      this.teamService,
      teamId,
      opening.sportType,
    );
    await assertCanActForTeam(
      team,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    const tournamentId = opening.tournamentId;
    if (!tournamentId) {
      throw new BadRequestException('Opening is missing its host');
    }
    await assertNoLiveTournamentInvitation(
      this.invitationModel,
      tournamentId,
      team._id,
    );
    const created = await this.insertEnrollment({
      opening,
      userId,
      status: EnrollmentStatus.PENDING,
      teamId,
    });
    return this.present(created, opening);
  }

  private async insertEnrollment(params: {
    opening: OpeningDocument;
    userId: string;
    status: EnrollmentStatus;
    teamId?: string;
  }): Promise<EnrollmentDocument> {
    try {
      return await this.enrollmentModel.create({
        openingId: params.opening._id,
        subjectType: params.opening.type,
        user: new Types.ObjectId(params.userId),
        teamId:
          params.opening.type === OpeningType.TEAM
            ? params.opening.teamId
            : params.teamId
              ? new Types.ObjectId(params.teamId)
              : undefined,
        tournamentId:
          params.opening.type === OpeningType.TOURNAMENT
            ? params.opening.tournamentId
            : undefined,
        status: params.status,
        reviewedAt:
          params.status === EnrollmentStatus.ACCEPTED ? new Date() : undefined,
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('You already have a pending enrollment');
      }
      throw error;
    }
  }

  private async requireOpenOpening(openingId: string): Promise<OpeningDocument> {
    assertObjectId(openingId, 'opening');
    const opening = await this.openingModel.findById(openingId);
    if (!opening) throw new NotFoundException('Opening not found');
    if (opening.status !== OpeningStatus.OPEN) {
      throw new BadRequestException('This opening is not taking enrollments');
    }
    return opening;
  }

  private async requirePendingForPoster(
    userId: string,
    openingId: string,
    enrollmentId: string,
  ): Promise<{ enrollment: EnrollmentDocument; opening: OpeningDocument }> {
    const { opening } = await this.openingsService.requireManaged(
      userId,
      openingId,
    );
    assertObjectId(enrollmentId, 'enrollment');
    const enrollment = await this.enrollmentModel.findOne({
      _id: enrollmentId,
      openingId: opening._id,
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.status !== EnrollmentStatus.PENDING) {
      throw new BadRequestException('Enrollment is not pending');
    }
    return { enrollment, opening };
  }

  private async markReviewed(
    enrollment: EnrollmentDocument,
    userId: string,
    status: EnrollmentStatus,
  ): Promise<void> {
    enrollment.status = status;
    enrollment.reviewedBy = new Types.ObjectId(userId);
    enrollment.reviewedAt = new Date();
    await enrollment.save();
  }

  private async paginate(
    filter: Record<string, unknown>,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<EnrollmentView>> {
    const skip = (page - 1) * limit;
    const [rows, totalDocuments] = await Promise.all([
      this.enrollmentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', userSelectFields)
        .populate('teamId', 'name logo')
        .exec(),
      this.enrollmentModel.countDocuments(filter),
    ]);
    const openings = await this.openingsById(rows.map((row) => row.openingId));
    const hosts = await this.hostSnapshotsFor(rows);
    return {
      data: rows.map((row) =>
        toEnrollmentView(
          row,
          openings.get(row.openingId.toString()),
          hosts.get(subjectKey(row) ?? ''),
        ),
      ),
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  private async openingsById(
    ids: Types.ObjectId[],
  ): Promise<Map<string, OpeningDocument>> {
    const unique = [...new Set(ids.map((id) => id.toString()))];
    if (!unique.length) return new Map();
    const docs = await this.openingModel.find({
      _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
    });
    return new Map(docs.map((doc) => [doc._id.toString(), doc]));
  }

  private async hostSnapshotsFor(
    rows: EnrollmentDocument[],
  ): Promise<Map<string, HostSnapshot>> {
    const teamIds: Types.ObjectId[] = [];
    const tournamentIds: Types.ObjectId[] = [];
    for (const row of rows) {
      if (row.subjectType === OpeningType.TEAM && row.teamId) {
        teamIds.push(row.teamId);
      } else if (row.tournamentId) {
        tournamentIds.push(row.tournamentId);
      }
    }
    const snapshots = new Map<string, HostSnapshot>();
    const [teams, tournaments] = await Promise.all([
      teamIds.length
        ? this.teamModel
            .find({ _id: { $in: teamIds } })
            .select('name logo location visibility status')
        : [],
      tournamentIds.length
        ? this.tournamentModel
            .find({ _id: { $in: tournamentIds } })
            .select('name coverImages venueName isPublic')
        : [],
    ]);
    for (const team of teams) {
      snapshots.set(team._id.toString(), teamSnapshot(team));
    }
    for (const tournament of tournaments) {
      snapshots.set(tournament._id.toString(), tournamentSnapshot(tournament));
    }
    return snapshots;
  }

  private async present(
    enrollment: EnrollmentDocument,
    opening: OpeningDocument,
  ): Promise<EnrollmentView> {
    const host = await this.snapshotFor(opening);
    return toEnrollmentView(enrollment, opening, host);
  }

  private async snapshotFor(opening: OpeningDocument): Promise<HostSnapshot> {
    if (opening.type === OpeningType.TEAM) {
      const team = await this.teamModel
        .findById(opening.teamId)
        .select('name logo location visibility status');
      if (!team) return { name: 'Unavailable', discoverable: false };
      return teamSnapshot(team);
    }
    const tournament = await this.tournamentModel
      .findById(opening.tournamentId)
      .select('name coverImages venueName isPublic');
    if (!tournament) return { name: 'Unavailable', discoverable: false };
    return tournamentSnapshot(tournament);
  }
}
