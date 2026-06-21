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
import { Model, PipelineStage, Types } from 'mongoose';
import { teamLeaderboardStatsFromTeam } from '../core/points/leaderboard-stats.helpers';
import type { TeamLeaderboardRow } from '../core/points/ranking-points.types';
import type { PaginatedResult } from '../core/interfaces/common';
import { resolveId } from '../core/utils/mongo-ref.util';
import {
  Team,
  TeamDocument,
  TeamStatus,
  TeamVisibility,
  SPORT_ROSTER_CONFIG,
  SportType,
} from './schemas/team.schema';
import { GeoLocation, GeoPoint } from '../core/schemas/geo-location.schema';
import {
  CreateTeamDto,
  TeamFilterDto,
  PromoteOwnerDto,
  UpdateTeamDto,
} from './dto/team.dto';
import omitEmpty from 'omit-empty';
import { userSelectFields } from '../users/schemas/user.schema';
import { TeamMemberService } from '../team-member/team-member.service';
import {
  TeamMatch,
  TeamMatchDocument,
} from '../matchmaking/schemas/team-match.schema';
import {
  assertCanViewTeam,
  buildTeamTextSearchClause,
  distinctOpponentsWithSentRequest,
} from './util/team.helpers';
import { StorageLifecycleService } from '../storage/storage-lifecycle.service';

@Injectable()
export class TeamService {
  private static readonly populate = [
    { path: 'createdBy', select: userSelectFields },
  ];

  constructor(
    @InjectModel(Team.name)
    private teamModel: Model<TeamDocument>,
    @InjectModel(TeamMatch.name)
    private teamMatchModel: Model<TeamMatchDocument>,
    @Inject(forwardRef(() => TeamMemberService))
    private teamMemberService: TeamMemberService,
    private readonly storageLifecycle: StorageLifecycleService,
  ) {}

  async create(userId: string, dto: CreateTeamDto): Promise<TeamDocument> {
    const uid = new Types.ObjectId(userId);
    const { location, ...fromDto } = dto;

    const doc = new this.teamModel({
      ...fromDto,
      location: location ? (location as GeoLocation) : undefined,
      createdBy: uid,
      ownerIds: [uid],
      logo: dto.logo ?? '',
      coverImages: dto.coverImages ?? [],
      status: TeamStatus.ACTIVE,
    });

    const saved = await doc.save();
    await this.teamMemberService.seedCreatorMembership(
      saved._id.toString(),
      userId,
    );

    const populated = (await saved.populate(
      TeamService.populate,
    )) as TeamDocument;

    const nextUrls = [
      ...(dto.logo ? [dto.logo] : []),
      ...(dto.coverImages ?? []),
    ];
    if (nextUrls.length > 0) {
      await this.storageLifecycle.syncUrlArrayOnEntitySave({
        userId,
        entityType: 'team',
        entityId: saved._id.toString(),
        previousUrls: [],
        nextUrls,
      });
    }

    return populated;
  }

  async findById(id: string, viewerId: string): Promise<TeamDocument> {
    const team = await this.teamModel
      .findById(id)
      .populate(TeamService.populate)
      .exec();

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    await assertCanViewTeam(
      team,
      viewerId,
      this.teamMemberService,
      (t, uid) => this.isOwner(t, uid),
    );
    return team;
  }

  async findMany(
    userId: string,
    filter: TeamFilterDto,
  ): Promise<PaginatedResult<TeamDocument>> {
    const {
      visibility,
      status,
      sportType,
      genderCategory,
      lookingForMembers,
      teamOpenForMatch,
      skipTeamsWithSentRequest,
      fromTeamId,
      search,
      page = 1,
      limit = 10,
      location,
    } = filter;
    const nearbyLat = location?.nearbyLat;
    const nearbyLng = location?.nearbyLng;
    const nearbyRadiusKm = location?.nearbyRadiusKm ?? 10;

    const uid = new Types.ObjectId(userId);
    const memberTeamIds =
      await this.teamMemberService.distinctActiveTeamIds(userId);

    const accessOr = [
      { visibility: TeamVisibility.PUBLIC },
      { ownerIds: uid },
      { _id: { $in: memberTeamIds } },
    ];

    const andClauses: Record<string, unknown>[] = [{ $or: accessOr }];
    const searchClause = search ? buildTeamTextSearchClause(search) : {};
    if (Object.keys(searchClause).length > 0) {
      andClauses.push(searchClause);
    }

    const baseMatch: Record<string, unknown> = {
      $and: andClauses,
    };

    if (visibility) {
      baseMatch.visibility = visibility;
    }
    if (status) {
      baseMatch.status = status;
    }
    if (sportType) {
      baseMatch.sportType = sportType;
    }
    if (genderCategory) {
      baseMatch.genderCategory = genderCategory;
    }
    if (lookingForMembers !== undefined) {
      baseMatch.lookingForMembers = lookingForMembers;
    }
    if (teamOpenForMatch !== undefined) {
      baseMatch.teamOpenForMatch = teamOpenForMatch;
    }

    if (skipTeamsWithSentRequest && fromTeamId) {
      const sentToTeamIds = await distinctOpponentsWithSentRequest(
        userId,
        fromTeamId,
        this.teamMatchModel,
        this,
        this.teamMemberService,
        (id) => this.requireTeam(id),
      );
      if (sentToTeamIds.length > 0) {
        baseMatch._id = { $nin: sentToTeamIds };
      }
    }

    const skip = (page - 1) * limit;

    if (nearbyLat !== undefined && nearbyLng !== undefined) {
      const geoMatch = {
        ...baseMatch,
        'location.coordinates': { $exists: true, $ne: null },
      };
      const pipeline: PipelineStage[] = [
        {
          $geoNear: {
            key: 'location.coordinates',
            near: {
              type: 'Point',
              coordinates: [nearbyLng, nearbyLat],
            },
            distanceField: 'distance',
            maxDistance: nearbyRadiusKm * 1000,
            spherical: true,
            query: geoMatch,
          },
        },
        {
          $facet: {
            metadata: [{ $count: 'total' }],
            data: [{ $skip: skip }, { $limit: limit }],
          },
        },
      ];

      const agg = await this.teamModel.aggregate(pipeline);
      const metadata = agg[0]?.metadata[0] || { total: 0 };
      const raw = agg[0]?.data || [];
      const ids = raw.map((d: { _id: Types.ObjectId }) => d._id);
      const docs = await this.teamModel
        .find({ _id: { $in: ids } })
        .populate(TeamService.populate)
        .exec();
      const order = new Map<string, number>(
        ids.map((id: Types.ObjectId, i: number) => [id.toString(), i]),
      );
      docs.sort((a, b) => {
        const ia: number = order.get(a._id.toString()) ?? 0;
        const ib: number = order.get(b._id.toString()) ?? 0;
        return ia - ib;
      });

      const total = metadata.total ?? 0;
      return {
        data: docs,
        totalDocuments: total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 0,
      };
    }

    const [data, totalDocuments] = await Promise.all([
      this.teamModel
        .find(baseMatch)
        .populate(TeamService.populate)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.teamModel.countDocuments(baseMatch),
    ]);

    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateTeamDto,
  ): Promise<TeamDocument> {
    const team = await this.requireTeam(id);
    this.assertOwner(team, userId);

    const previousLogo = team.logo;
    const previousCoverImages = team.coverImages ?? [];

    const { location, status, ...scalarPatch } = dto;

    Object.assign(team, omitEmpty(scalarPatch));

    if (status !== undefined) {
      team.status = status as TeamStatus;
    }

    if (location !== undefined) {
      if (location === null) {
        team.set('location', undefined);
      } else if (!team.location) {
        if (location.address !== undefined && location.coordinates !== undefined) {
          team.location = {
            address: location.address,
            coordinates: location.coordinates as GeoPoint,
          };
        } else {
          throw new BadRequestException(
            'When setting location for the first time, provide both address and coordinates',
          );
        }
      } else {
        if (location.address !== undefined) {
          team.location.address = location.address;
        }
        if (location.coordinates !== undefined) {
          team.location.coordinates = location.coordinates as GeoPoint;
        }
      }
    }

    await team.save();

    if (dto.logo !== undefined || dto.coverImages !== undefined) {
      const previousUrls: string[] = [];
      const nextUrls: string[] = [];
      if (dto.logo !== undefined) {
        if (previousLogo) previousUrls.push(previousLogo);
        if (dto.logo) nextUrls.push(dto.logo);
      }
      if (dto.coverImages !== undefined) {
        previousUrls.push(...previousCoverImages);
        nextUrls.push(...(dto.coverImages ?? []));
      }
      await this.storageLifecycle.syncUrlArrayOnEntitySave({
        userId,
        entityType: 'team',
        entityId: team._id.toString(),
        previousUrls,
        nextUrls,
      });
    }

    return (await team.populate(TeamService.populate)) as TeamDocument;
  }

  async delete(id: string, userId: string): Promise<void> {
    const team = await this.requireTeam(id);
    if (resolveId(team.createdBy) !== resolveId(userId)) {
      throw new ForbiddenException('Only the creator can delete this team');
    }
    const urls = [
      ...(team.logo ? [team.logo] : []),
      ...(team.coverImages ?? []),
    ];
    await this.teamModel.findByIdAndDelete(id);
    if (urls.length > 0) {
      await this.storageLifecycle.deleteUrlsForUser(userId, urls);
    }
  }

  async promoteOwner(
    teamId: string,
    ownerUserId: string,
    dto: PromoteOwnerDto,
  ): Promise<TeamDocument> {
    const team = await this.requireTeam(teamId);
    this.assertOwner(team, ownerUserId);

    const targetId = dto.userId;
    const isActiveMember = await this.teamMemberService.hasActiveMembership(
      teamId,
      targetId,
    );

    if (!isActiveMember) {
      throw new BadRequestException(
        'User must be an active member before becoming an owner',
      );
    }

    if (team.ownerIds.some((o) => resolveId(o) === resolveId(targetId))) {
      throw new ConflictException('User is already an owner');
    }

    team.ownerIds.push(new Types.ObjectId(targetId));
    await team.save();
    return (await team.populate(TeamService.populate)) as TeamDocument;
  }

  async demoteOwner(
    teamId: string,
    ownerUserId: string,
    targetUserId: string,
  ): Promise<TeamDocument> {
    const team = await this.requireTeam(teamId);
    this.assertOwner(team, ownerUserId);

    if (resolveId(targetUserId) === resolveId(team.createdBy)) {
      throw new ForbiddenException(
        'Cannot remove the original creator as owner',
      );
    }

    const idx = team.ownerIds.findIndex(
      (o) => resolveId(o) === resolveId(targetUserId),
    );
    if (idx === -1) {
      throw new NotFoundException('User is not an owner');
    }

    team.ownerIds.splice(idx, 1);
    if (team.ownerIds.length === 0) {
      throw new BadRequestException('Team must keep at least one owner');
    }

    await team.save();
    return (await team.populate(TeamService.populate)) as TeamDocument;
  }

  async requireTeam(id: string): Promise<TeamDocument> {
    const team = await this.teamModel.findById(id);
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  assertOwner(team: TeamDocument, userId: string): void {
    if (!this.isOwner(team, userId)) {
      throw new ForbiddenException('Only owners can perform this action');
    }
  }

  isOwner(team: TeamDocument, userId: string): boolean {
    return team.ownerIds.some((o) => resolveId(o) === resolveId(userId));
  }

  async getLeaderboard(
    sportType: SportType,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<TeamLeaderboardRow>> {
    const filter = { sportType, status: TeamStatus.ACTIVE };
    const skip = (page - 1) * limit;

    const [teams, totalDocuments] = await Promise.all([
      this.teamModel
        .find(filter)
        .sort({ rankingPoints: -1, name: 1 })
        .skip(skip)
        .limit(limit)
        .select(
          'name logo rankingPoints matchesPlayed wins losses draws winRate',
        )
        .lean(),
      this.teamModel.countDocuments(filter),
    ]);

    return {
      data: teams.map((t, index) => ({
        rank: skip + index + 1,
        id: t._id.toString(),
        name: t.name,
        points: t.rankingPoints ?? 0,
        stats: teamLeaderboardStatsFromTeam(t),
        ...(t.logo ? { avatar: t.logo } : {}),
      })),
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }
}
