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
import {
  Team,
  TeamDocument,
  TeamStatus,
  TeamVisibility,
} from './schemas/team.schema';
import { GeoLocation, GeoPoint } from '../core/schemas/geo-location.schema';
import {
  CreateTeamDto,
  TeamFilterDto,
  PromoteOwnerDto,
  UpdateTeamDto,
} from './dto/team.dto';
import omitEmpty from 'omit-empty';
import { PaginatedResult } from '../core/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';
import { TeamMemberService } from '../team-member/team-member.service';

@Injectable()
export class TeamService {
  private static readonly populate = [
    { path: 'createdBy', select: userSelectFields },
  ];

  constructor(
    @InjectModel(Team.name)
    private teamModel: Model<TeamDocument>,
    @Inject(forwardRef(() => TeamMemberService))
    private teamMemberService: TeamMemberService,
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
    return (await saved.populate(
      TeamService.populate,
    )) as TeamDocument;
  }

  async findById(id: string, viewerId: string): Promise<TeamDocument> {
    const team = await this.teamModel
      .findById(id)
      .populate(TeamService.populate)
      .exec();

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    await this.assertCanView(team, viewerId);
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

    const baseMatch: Record<string, unknown> = {
      $or: accessOr,
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
    return (await team.populate(TeamService.populate)) as TeamDocument;
  }

  async delete(id: string, userId: string): Promise<void> {
    const team = await this.requireTeam(id);
    if (team.createdBy.toString() !== userId) {
      throw new ForbiddenException('Only the creator can delete this team');
    }
    await this.teamModel.findByIdAndDelete(id);
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

    if (team.ownerIds.some((o) => o.toString() === targetId)) {
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

    if (targetUserId === team.createdBy.toString()) {
      throw new ForbiddenException(
        'Cannot remove the original creator as owner',
      );
    }

    const idx = team.ownerIds.findIndex((o) => o.toString() === targetUserId);
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

  private async assertCanView(
    team: TeamDocument,
    viewerId: string,
  ): Promise<void> {
    if (team.visibility === TeamVisibility.PUBLIC) {
      return;
    }
    if (this.isOwner(team, viewerId)) {
      return;
    }
    if (
      await this.teamMemberService.hasActiveMembership(
        team._id.toString(),
        viewerId,
      )
    ) {
      return;
    }
    throw new ForbiddenException('You cannot view this private team');
  }

  isOwner(team: TeamDocument, userId: string): boolean {
    return team.ownerIds.some((o) => o.toString() === userId);
  }
}
