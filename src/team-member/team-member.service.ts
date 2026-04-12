import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  LeadershipRole,
  LineupCategory,
  TeamMember,
  TeamMemberDocument,
  TeamMemberStatus,
} from './schemas/team-member.schema';
import { TeamService } from '../team/team.service';
import {
  teamPopulateSelectFields,
  TeamJoinMode,
  TeamStatus,
  TeamVisibility,
  SPORT_ROSTER_CONFIG,
  SportType,
} from '../team/schemas/team.schema';
import { ConnectionsService } from '../connections/connections.service';
import { PaginatedResult } from '../core/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';
import {
  SuspendTeamMemberDto,
  UpdateTeamMemberDto,
} from './dto/team-member.dto';

@Injectable()
export class TeamMemberService {
  private static readonly populate = [
    { path: 'user', select: userSelectFields },
    { path: 'team', select: teamPopulateSelectFields },
    { path: 'reviewedBy', select: userSelectFields },
  ];

  constructor(
    @InjectModel(TeamMember.name)
    private teamMemberModel: Model<TeamMemberDocument>,
    @Inject(forwardRef(() => TeamService))
    private teamService: TeamService,
    private connectionsService: ConnectionsService,
  ) {}

  async seedCreatorMembership(
    teamId: string,
    userId: string,
  ): Promise<TeamMemberDocument> {
    const doc = new this.teamMemberModel({
      team: new Types.ObjectId(teamId),
      user: new Types.ObjectId(userId),
      status: TeamMemberStatus.ACTIVE,
      leadershipRole: LeadershipRole.CAPTAIN,
      lineupCategory: LineupCategory.STARTER,
      joinedAt: new Date(),
    });
    const saved = await doc.save();
    return (await saved.populate(
      TeamMemberService.populate,
    )) as TeamMemberDocument;
  }

  async distinctActiveTeamIds(userId: string): Promise<Types.ObjectId[]> {
    return this.teamMemberModel.distinct('team', {
      user: new Types.ObjectId(userId),
      status: TeamMemberStatus.ACTIVE,
    });
  }

  async countActiveMembers(teamId: string): Promise<number> {
    return this.teamMemberModel.countDocuments({
      team: new Types.ObjectId(teamId),
      status: TeamMemberStatus.ACTIVE,
    });
  }

  async hasActiveMembership(teamId: string, userId: string): Promise<boolean> {
    const found = await this.teamMemberModel.findOne({
      team: new Types.ObjectId(teamId),
      user: new Types.ObjectId(userId),
      status: TeamMemberStatus.ACTIVE,
    });
    return !!found;
  }

  async hasActiveLeadershipMembership(
    teamId: string,
    userId: string,
    leadershipRoles: LeadershipRole[],
  ): Promise<boolean> {
    const found = await this.teamMemberModel.findOne({
      team: new Types.ObjectId(teamId),
      user: new Types.ObjectId(userId),
      status: TeamMemberStatus.ACTIVE,
      leadershipRole: { $in: leadershipRoles },
    });
    return !!found;
  }

  async distinctTeamIdsByMembershipFilter(
    filter: Record<string, unknown>,
  ): Promise<Types.ObjectId[]> {
    return this.teamMemberModel.distinct('team', filter);
  }

  async findManyForTeam(
    teamId: string,
    viewerId: string,
    status: TeamMemberStatus | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<TeamMemberDocument>> {
    await this.teamService.findById(teamId, viewerId);
    const filter: Record<string, unknown> = {
      team: new Types.ObjectId(teamId),
    };
    if (status) {
      filter.status = status;
    }
    const skip = (page - 1) * limit;
    const [data, totalDocuments] = await Promise.all([
      this.teamMemberModel
        .find(filter)
        .populate(TeamMemberService.populate)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.teamMemberModel.countDocuments(filter),
    ]);
    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async findMyMemberships(
    userId: string,
    status: TeamMemberStatus | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<TeamMemberDocument>> {
    const filter: Record<string, unknown> = {
      user: new Types.ObjectId(userId),
    };
    if (status) {
      filter.status = status;
    }
    const skip = (page - 1) * limit;
    const [data, totalDocuments] = await Promise.all([
      this.teamMemberModel
        .find(filter)
        .populate(TeamMemberService.populate)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.teamMemberModel.countDocuments(filter),
    ]);
    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async join(teamId: string, userId: string): Promise<TeamMemberDocument> {
    const team = await this.teamService.requireTeam(teamId);
    this.assertTeamRecruiting(team);

    const uid = new Types.ObjectId(userId);
    await this.assertNoOpenStint(teamId, userId);

    if (team.visibility === TeamVisibility.PRIVATE) {
      const allowed = await this.connectionsService.isConnectedToAny(
        userId,
        team.ownerIds,
      );
      if (!allowed) {
        throw new ForbiddenException(
          'Only users connected to an owner can join private teams',
        );
      }
    }

    const effectiveOpen =
      team.visibility === TeamVisibility.PUBLIC &&
      team.joinMode === TeamJoinMode.OPEN;

    if (effectiveOpen) {
      await this.assertRosterHasRoom(teamId, team);
      const doc = new this.teamMemberModel({
        team: new Types.ObjectId(teamId),
        user: uid,
        status: TeamMemberStatus.ACTIVE,
        lineupCategory: LineupCategory.STARTER,
        joinedAt: new Date(),
      });
      const saved = await doc.save();
      return (await saved.populate(
        TeamMemberService.populate,
      )) as TeamMemberDocument;
    }

    const pendingCount = await this.teamMemberModel.countDocuments({
      team: new Types.ObjectId(teamId),
      status: TeamMemberStatus.PENDING,
    });
    if (pendingCount >= team.maxPendingJoinRequests) {
      throw new ConflictException(
        'This team is not accepting more join requests',
      );
    }

    const doc = new this.teamMemberModel({
      team: new Types.ObjectId(teamId),
      user: uid,
      status: TeamMemberStatus.PENDING,
      lineupCategory: LineupCategory.STARTER,
    });
    const saved = await doc.save();
    return (await saved.populate(
      TeamMemberService.populate,
    )) as TeamMemberDocument;
  }

  async acceptRequest(
    teamId: string,
    membershipId: string,
    ownerUserId: string,
  ): Promise<TeamMemberDocument> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const m = await this.requireMembership(membershipId, teamId);
    if (m.status !== TeamMemberStatus.PENDING) {
      throw new BadRequestException('Membership is not pending');
    }

    await this.assertRosterHasRoom(teamId, team);

    m.status = TeamMemberStatus.ACTIVE;
    m.joinedAt = new Date();
    m.reviewedBy = new Types.ObjectId(ownerUserId);
    m.reviewedAt = new Date();
    await m.save();
    return (await m.populate(
      TeamMemberService.populate,
    )) as TeamMemberDocument;
  }

  async rejectRequest(
    teamId: string,
    membershipId: string,
    ownerUserId: string,
  ): Promise<TeamMemberDocument> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const m = await this.requireMembership(membershipId, teamId);
    if (m.status !== TeamMemberStatus.PENDING) {
      throw new BadRequestException('Membership is not pending');
    }

    m.status = TeamMemberStatus.REJECTED;
    m.leftAt = new Date();
    m.reviewedBy = new Types.ObjectId(ownerUserId);
    m.reviewedAt = new Date();
    await m.save();
    return (await m.populate(
      TeamMemberService.populate,
    )) as TeamMemberDocument;
  }

  async resign(teamId: string, userId: string): Promise<void> {
    const team = await this.teamService.requireTeam(teamId);
    const m = await this.teamMemberModel.findOne({
      team: new Types.ObjectId(teamId),
      user: new Types.ObjectId(userId),
      status: TeamMemberStatus.ACTIVE,
    });
    if (!m) {
      throw new BadRequestException('You are not an active member of this team');
    }

    const isOwner = team.ownerIds.some((o) => o.toString() === userId);
    if (isOwner && team.ownerIds.length === 1) {
      throw new ForbiddenException(
        'You are the only owner; assign another owner before leaving',
      );
    }

    if (isOwner) {
      team.ownerIds = team.ownerIds.filter((o) => o.toString() !== userId);
      await team.save();
    }

    m.status = TeamMemberStatus.RESIGNED;
    m.leftAt = new Date();
    m.leadershipRole = undefined;
    await m.save();
  }

  async removeMember(
    teamId: string,
    targetUserId: string,
    ownerUserId: string,
  ): Promise<void> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    if (targetUserId === team.createdBy.toString()) {
      throw new ForbiddenException('Cannot remove the team creator');
    }

    const m = await this.teamMemberModel.findOne({
      team: new Types.ObjectId(teamId),
      user: new Types.ObjectId(targetUserId),
      status: TeamMemberStatus.ACTIVE,
    });
    if (!m) {
      throw new NotFoundException('Active membership not found');
    }

    const idx = team.ownerIds.findIndex((o) => o.toString() === targetUserId);
    if (idx !== -1) {
      team.ownerIds.splice(idx, 1);
      await team.save();
    }

    m.status = TeamMemberStatus.REMOVED;
    m.leftAt = new Date();
    m.leadershipRole = undefined;
    await m.save();
  }

  async updateMember(
    teamId: string,
    membershipId: string,
    ownerUserId: string,
    dto: UpdateTeamMemberDto,
  ): Promise<TeamMemberDocument> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const m = await this.requireMembership(membershipId, teamId);
    if (m.status !== TeamMemberStatus.ACTIVE) {
      throw new BadRequestException('Can only update active members');
    }

    if (dto.lineupCategory !== undefined) {
      m.lineupCategory = dto.lineupCategory as LineupCategory;
    }
    if (dto.playingPosition !== undefined) {
      m.playingPosition =
        dto.playingPosition === null ? undefined : dto.playingPosition;
    }

    if (dto.leadershipRole !== undefined) {
      if (dto.leadershipRole === null) {
        m.leadershipRole = undefined;
      } else {
        await this.clearConflictingLeadership(
          teamId,
          m._id.toString(),
          dto.leadershipRole as LeadershipRole,
        );
        m.leadershipRole = dto.leadershipRole as LeadershipRole;
      }
    }

    if (dto.jerseyNumber !== undefined) {
      m.jerseyNumber = dto.jerseyNumber === null ? undefined : dto.jerseyNumber;
    }

    if (dto.nickname !== undefined) {
      m.nickname = dto.nickname === null ? undefined : dto.nickname;
    }

    if (dto.isVerified !== undefined) {
      m.isVerified = dto.isVerified;
    }

    await m.save();
    return (await m.populate(
      TeamMemberService.populate,
    )) as TeamMemberDocument;
  }

  async suspend(
    teamId: string,
    membershipId: string,
    ownerUserId: string,
    dto: SuspendTeamMemberDto,
  ): Promise<TeamMemberDocument> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const m = await this.requireMembership(membershipId, teamId);
    if (m.status !== TeamMemberStatus.ACTIVE) {
      throw new BadRequestException('Only active members can be suspended');
    }

    if (m.user.toString() === team.createdBy.toString()) {
      throw new ForbiddenException('Cannot suspend the team creator');
    }

    m.status = TeamMemberStatus.SUSPENDED;
    m.suspendedUntil = dto.suspendedUntil;
    m.leadershipRole = undefined;
    await m.save();
    return (await m.populate(
      TeamMemberService.populate,
    )) as TeamMemberDocument;
  }

  async unsuspend(
    teamId: string,
    membershipId: string,
    ownerUserId: string,
  ): Promise<TeamMemberDocument> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const m = await this.requireMembership(membershipId, teamId);
    if (m.status !== TeamMemberStatus.SUSPENDED) {
      throw new BadRequestException('Member is not suspended');
    }

    m.status = TeamMemberStatus.ACTIVE;
    m.suspendedUntil = undefined;
    await m.save();
    return (await m.populate(
      TeamMemberService.populate,
    )) as TeamMemberDocument;
  }

  private async clearConflictingLeadership(
    teamId: string,
    exceptMembershipId: string,
    role: LeadershipRole,
  ): Promise<void> {
    await this.teamMemberModel.updateMany(
      {
        team: new Types.ObjectId(teamId),
        status: TeamMemberStatus.ACTIVE,
        leadershipRole: role,
        _id: { $ne: new Types.ObjectId(exceptMembershipId) },
      },
      { $unset: { leadershipRole: 1 } },
    );
  }

  private async requireMembership(
    id: string,
    teamId: string,
  ): Promise<TeamMemberDocument> {
    const m = await this.teamMemberModel.findById(id);
    if (!m || m.team.toString() !== teamId) {
      throw new NotFoundException('Team membership not found');
    }
    return m;
  }

  private assertTeamRecruiting(team: {
    status: TeamStatus;
  }): void {
    if (team.status !== TeamStatus.ACTIVE) {
      throw new BadRequestException('This team is not recruiting');
    }
  }

  private async assertRosterHasRoom(
    teamId: string,
    team: { sportType: string },
  ): Promise<void> {
    const config = SPORT_ROSTER_CONFIG[team.sportType as SportType];
    const max = config?.max ?? 500;
    const n = await this.countActiveMembers(teamId);
    if (n >= max) {
      throw new ConflictException('Team roster is full');
    }
  }

  private async assertNoOpenStint(
    teamId: string,
    userId: string,
  ): Promise<void> {
    const existing = await this.teamMemberModel.findOne({
      team: new Types.ObjectId(teamId),
      user: new Types.ObjectId(userId),
      status: {
        $in: [
          TeamMemberStatus.PENDING,
          TeamMemberStatus.ACTIVE,
          TeamMemberStatus.SUSPENDED,
        ],
      },
    });
    if (existing) {
      throw new ConflictException(
        'You already have an active, pending, or suspended membership for this team',
      );
    }
  }
}
