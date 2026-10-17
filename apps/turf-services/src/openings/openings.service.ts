import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { SportType } from '../core/sports/sport-types';
import { applyExcludeIds } from '../core/utils/geo-near-page.util';
import {
  Enrollment,
  EnrollmentDocument,
  EnrollmentStatus,
} from '../enrollments/schemas/enrollment.schema';
import {
  Team,
  TeamDocument,
  TeamStatus,
} from '../team/schemas/team.schema';
import {
  teamSnapshot,
  tournamentSnapshot,
} from './util/opening-host.util';
import { TeamService } from '../team/team.service';
import { Tournament, TournamentDocument } from '../tournament/schemas/tournament.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  assertCanManage,
  assertCanPost,
  assertObjectId,
  hostId,
} from './util/opening-asserts.util';
import {
  hostOf,
  OpeningAggRow,
  OpeningView,
  TeamHostDoc,
  toOpeningView,
} from './util/opening-view.util';
import {
  CreateOpeningDto,
  OpeningFilterDto,
  UpdateOpeningDto,
} from './dto/opening.dto';
import {
  Opening,
  OpeningDocument,
  OpeningJoinMode,
  OpeningStatus,
  OpeningType,
} from './schemas/opening.schema';

type MineAggRow = TeamHostDoc & {
  _id: Types.ObjectId;
  sportType?: SportType;
  openings?: OpeningAggRow[];
};

type TournamentMineRow = {
  _id: Types.ObjectId;
  name: string;
  sportType: SportType;
  coverImages?: string[];
  venueName?: string;
  isPublic?: boolean;
  openings?: OpeningAggRow[];
};

type MineHost = {
  type: OpeningType;
  _id: string;
  name: string;
  sportType?: SportType;
  discoverable: boolean;
  openings: OpeningView[];
};

@Injectable()
export class OpeningsService {
  private readonly logger = new Logger(OpeningsService.name);

  constructor(
    @InjectModel(Opening.name)
    private readonly openingModel: Model<OpeningDocument>,
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    @InjectModel(Tournament.name)
    private readonly tournamentModel: Model<TournamentDocument>,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly teamService: TeamService,
  ) {}


  async create(userId: string, dto: CreateOpeningDto): Promise<OpeningView> {
    const type = dto.type as OpeningType;
    const id = type === OpeningType.TEAM ? dto.teamId : dto.tournamentId;
    assertObjectId(id ?? '', type === OpeningType.TEAM ? 'team' : 'tournament');
    const host = await assertCanPost(
      this.teamService,
      this.tournamentModel,
      userId,
      type,
      id!,
    );

    const created = await this.openingModel.create({
      type,
      teamId: type === OpeningType.TEAM ? new Types.ObjectId(id) : undefined,
      tournamentId:
        type === OpeningType.TOURNAMENT ? new Types.ObjectId(id) : undefined,
      postedBy: new Types.ObjectId(userId),
      title: dto.title.trim(),
      sportType: host.sportType,
      status: OpeningStatus.OPEN,
      joinMode: OpeningJoinMode.APPROVAL,
      maxPendingJoinRequests: dto.maxPendingJoinRequests,
    });
    return toOpeningView(created, host.snapshot);
  }

  async update(
    userId: string,
    openingId: string,
    dto: UpdateOpeningDto,
  ): Promise<OpeningView> {
    assertObjectId(openingId, 'opening');
    const opening = await this.openingModel.findById(openingId);
    if (!opening) {
      throw new NotFoundException('Opening not found');
    }

    const id = hostId(opening);
    const host = await assertCanManage(
      this.teamService,
      this.tournamentModel,
      userId,
      opening.type,
      id,
    );

    if (dto.title !== undefined) {
      opening.title = dto.title.trim();
    }
    if (dto.status !== undefined) {
      opening.status = dto.status as OpeningStatus;
    }
    if (dto.maxPendingJoinRequests !== undefined) {
      opening.maxPendingJoinRequests = dto.maxPendingJoinRequests;
    }

    await opening.save();

    return toOpeningView(opening, host.snapshot);
  }

  async findMany(
    query: OpeningFilterDto,
    userId?: string,
    extra?: { excludeIds?: string[]; search?: string },
  ) {
    const match: Record<string, unknown> = { status: query.status };
    if (query.type) match.type = query.type;
    if (query.sportType) match.sportType = query.sportType;
    applyExcludeIds(match, extra?.excludeIds);

    const skip = (query.page - 1) * query.limit;
    const search = extra?.search?.trim();
    const pre: PipelineStage[] = [{ $match: match }];
    if (search) {
      pre.push(...this.hostLookupStages(), this.textSearchStage(search));
    }
    const [result] = await this.openingModel
      .aggregate<{ total: { n: number }[]; page: OpeningAggRow[] }>([
        ...pre,
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            total: [{ $count: 'n' }],
            page: [
              { $skip: skip },
              { $limit: query.limit },
              ...(search ? [] : this.hostLookupStages()),
            ],
          },
        },
      ])
      .exec();

    const totalDocuments = result?.total[0]?.n ?? 0;
    const data = (result?.page ?? []).flatMap((row) => {
      const host = hostOf(row);
      if (!host?.discoverable) return [];
      return [toOpeningView(row, host)];
    });
    if (userId) await this.attachViewerStatus(userId, data);

    return {
      data,
      totalDocuments,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(totalDocuments / query.limit) || 0,
    };
  }

  /** Same public list shape as [findMany], including [OpeningView.myStatus], in id order. */
  async findByIds(ids: string[], userId?: string): Promise<OpeningView[]> {
    const unique = [...new Set(ids.filter((id) => Types.ObjectId.isValid(id)))];
    if (!unique.length) return [];
    const rows = await this.openingModel
      .aggregate<OpeningAggRow>([
        {
          $match: {
            _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
            status: OpeningStatus.OPEN,
          },
        },
        ...this.hostLookupStages(),
      ])
      .exec();
    const data = rows.flatMap((row) => {
      const host = hostOf(row);
      if (!host?.discoverable) return [];
      return [toOpeningView(row, host)];
    });
    if (userId) await this.attachViewerStatus(userId, data);
    const order = new Map(ids.map((id, index) => [id, index]));
    data.sort((a, b) => (order.get(a._id) ?? 0) - (order.get(b._id) ?? 0));
    return data;
  }

  /** Owned teams and organized tournaments, each with its live opening. */
  async findMine(userId: string) {
    assertObjectId(userId, 'user');
    const userObjectId = new Types.ObjectId(userId);
    const [teams, tournaments] = await Promise.all([
      this.ownedTeamHosts(userObjectId),
      this.organizedTournamentHosts(userObjectId),
    ]);
    const hosts = [...teams, ...tournaments].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return { hosts };
  }

  /** Newest open or on-hold opening for a host, if one exists. */
  async findCurrent(
    type: OpeningType,
    hostId: string,
    userId?: string,
  ): Promise<OpeningView | null> {
    assertObjectId(hostId, type === OpeningType.TEAM ? 'team' : 'tournament');
    const hostField = type === OpeningType.TEAM ? 'teamId' : 'tournamentId';
    const [row] = await this.openingModel
      .aggregate<OpeningAggRow>([
        {
          $match: {
            type,
            [hostField]: new Types.ObjectId(hostId),
            status: { $in: [OpeningStatus.OPEN, OpeningStatus.ON_HOLD] },
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: 1 },
        ...this.hostLookupStages(),
      ])
      .exec();
    if (!row) return null;
    const view = toOpeningView(
      row,
      hostOf(row) ?? { name: 'Unavailable', discoverable: false },
    );
    if (userId) await this.attachViewerStatus(userId, [view]);
    return view;
  }

  async requireManaged(userId: string, openingId: string) {
    assertObjectId(openingId, 'opening');
    const opening = await this.openingModel.findById(openingId);
    if (!opening) {
      throw new NotFoundException('Opening not found');
    }
    const host = await assertCanManage(
      this.teamService,
      this.tournamentModel,
      userId,
      opening.type,
      hostId(opening),
    );
    return { opening, host };
  }

  private async ownedTeamHosts(userId: Types.ObjectId): Promise<MineHost[]> {
    const rows = await this.teamModel
      .aggregate<MineAggRow>([
        {
          $match: {
            ownerIds: userId,
            status: { $ne: TeamStatus.ARCHIVED },
          },
        },
        ...this.liveOpeningLookup(OpeningType.TEAM),
      ])
      .exec();
    return rows.map((row) => {
      const snapshot = teamSnapshot(row);
      return {
        type: OpeningType.TEAM,
        _id: row._id.toString(),
        name: row.name,
        sportType: row.sportType,
        discoverable: snapshot.discoverable,
        openings: (row.openings ?? []).map((opening) =>
          toOpeningView(opening, snapshot),
        ),
      };
    });
  }

  private async organizedTournamentHosts(
    userId: Types.ObjectId,
  ): Promise<MineHost[]> {
    const rows = await this.tournamentModel
      .aggregate<TournamentMineRow>([
        {
          $match: {
            $or: [
              { organizerIds: userId },
              {
                organizerUserId: userId,
                $or: [
                  { organizerIds: { $exists: false } },
                  { organizerIds: { $size: 0 } },
                ],
              },
            ],
          },
        },
        ...this.liveOpeningLookup(OpeningType.TOURNAMENT),
      ])
      .exec();
    return rows.map((row) => {
      const snapshot = tournamentSnapshot(row);
      return {
        type: OpeningType.TOURNAMENT,
        _id: row._id.toString(),
        name: row.name,
        sportType: row.sportType,
        discoverable: snapshot.discoverable,
        openings: (row.openings ?? []).map((opening) =>
          toOpeningView(opening, snapshot),
        ),
      };
    });
  }

  private liveOpeningLookup(type: OpeningType): PipelineStage[] {
    return [
      {
        $lookup: {
          from: this.openingModel.collection.name,
          let: { targetId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$type', type] },
                    {
                      $eq: [
                        type === OpeningType.TEAM ? '$teamId' : '$tournamentId',
                        '$$targetId',
                      ],
                    },
                    {
                      $in: [
                        '$status',
                        [OpeningStatus.OPEN, OpeningStatus.ON_HOLD],
                      ],
                    },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
          ],
          as: 'openings',
        },
      },
      {
        $project: {
          name: 1,
          logo: 1,
          location: 1,
          visibility: 1,
          status: 1,
          sportType: 1,
          coverImages: 1,
          venueName: 1,
          isPublic: 1,
          openings: 1,
        },
      },
    ];
  }

  private async attachViewerStatus(userId: string, views: OpeningView[]) {
    if (!views.length || !Types.ObjectId.isValid(userId)) return;
    const rows = await this.enrollmentModel
      .find({
        openingId: { $in: views.map((view) => new Types.ObjectId(view._id)) },
        user: new Types.ObjectId(userId),
        status: {
          $in: [EnrollmentStatus.PENDING, EnrollmentStatus.ACCEPTED],
        },
      })
      .select('openingId status')
      .lean();
    const byOpening = new Map<
      string,
      EnrollmentStatus.PENDING | EnrollmentStatus.ACCEPTED
    >();
    for (const row of rows) {
      const key = row.openingId.toString();
      if (byOpening.get(key) === EnrollmentStatus.PENDING) continue;
      if (
        row.status === EnrollmentStatus.PENDING ||
        row.status === EnrollmentStatus.ACCEPTED
      ) {
        byOpening.set(key, row.status);
      }
    }
    for (const view of views) {
      view.myStatus = byOpening.get(view._id) ?? null;
    }
  }

  private textSearchStage(search: string): PipelineStage {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    return {
      $match: {
        $or: [
          { title: regex },
          { 'teamHost.name': regex },
          { 'tournamentHost.name': regex },
        ],
      },
    };
  }

  private hostLookupStages(): PipelineStage.FacetPipelineStage[] {
    return [
      {
        $lookup: {
          from: this.teamModel.collection.name,
          let: { teamId: '$teamId', openingType: '$type' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$$openingType', OpeningType.TEAM] },
                    { $eq: ['$_id', '$$teamId'] },
                  ],
                },
              },
            },
            {
              $project: {
                name: 1,
                logo: 1,
                location: 1,
                visibility: 1,
                status: 1,
              },
            },
          ],
          as: 'teamHost',
        },
      },
      {
        $lookup: {
          from: this.tournamentModel.collection.name,
          let: { tournamentId: '$tournamentId', openingType: '$type' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$$openingType', OpeningType.TOURNAMENT] },
                    { $eq: ['$_id', '$$tournamentId'] },
                  ],
                },
              },
            },
            {
              $project: {
                name: 1,
                coverImages: 1,
                venueName: 1,
                isPublic: 1,
              },
            },
          ],
          as: 'tournamentHost',
        },
      },
      {
        $lookup: {
          from: this.userModel.collection.name,
          let: { postedBy: '$postedBy' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$_id', '$$postedBy'] },
              },
            },
            { $project: { fullName: 1, avatar: 1 } },
          ],
          as: 'poster',
        },
      },
    ];
  }
}
