import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ContentPost,
  ContentPostDocument,
  PostStatus,
} from './schemas/content-post.schema';
import { Media, MediaDocument, MediaKind } from './schemas/media.schema';
import {
  CreateMediaDto,
  CreatePostDto,
  PostFilterDto,
  UpdatePostDto,
} from './dto/post.dto';
import { TeamService } from '../team/team.service';
import { TeamMemberService } from '../team-member/team-member.service';
import { PaginatedResult } from '../core/interfaces/common';
import {
  applyExcludeIds,
  paginateSortedByDistance,
} from '../core/utils/geo-near-page.util';
import { userSelectFields } from '../users/schemas/user.schema';
import { turfSelectFields, Turf, TurfDocument } from '../turf/schemas/turf.schema';
import { GeoLocation } from '../core/schemas/geo-location.schema';
import { StorageLifecycleService } from '../storage/storage-lifecycle.service';
import { resolveId } from '../core/utils/mongo-ref.util';
import {
  TeamMatch,
  TeamMatchDocument,
} from '../matchmaking/schemas/team-match.schema';
import { Team, TeamDocument } from '../team/schemas/team.schema';
import {
  ensureMatchHasTeam,
  requireTeamMatch,
} from '../matchmaking/util/matchmaking.helpers';
import {
  assertMatchAllowsPhotoPosts,
  assertUserCanPostForMatch,
  resolveSelectedTurfId,
} from './util/post-match-context.util';

@Injectable()
export class PostService {
  private static readonly populate = [
    { path: 'postedBy', select: userSelectFields },
    {
      path: 'team',
      select: '_id name logo sportType visibility status',
    },
    { path: 'match', select: '_id fromTeam toTeam status sportType' },
    { path: 'turf', select: turfSelectFields },
    { path: 'media' },
  ];

  constructor(
    @InjectModel(ContentPost.name)
    private postModel: Model<ContentPostDocument>,
    @InjectModel(Media.name)
    private mediaModel: Model<MediaDocument>,
    @InjectModel(TeamMatch.name)
    private teamMatchModel: Model<TeamMatchDocument>,
    @InjectModel(Team.name)
    private teamModel: Model<TeamDocument>,
    @InjectModel(Turf.name)
    private turfModel: Model<TurfDocument>,
    private teamService: TeamService,
    @Inject(forwardRef(() => TeamMemberService))
    private teamMemberService: TeamMemberService,
    private readonly storageLifecycle: StorageLifecycleService,
  ) {}

  async registerMedia(
    userId: string,
    dto: CreateMediaDto,
  ): Promise<MediaDocument> {
    const doc = new this.mediaModel({
      url: dto.url,
      kind: dto.kind as MediaKind,
      caption: dto.caption,
      uploadedBy: new Types.ObjectId(userId),
    });
    return doc.save();
  }

  async create(
    userId: string,
    dto: CreatePostDto,
  ): Promise<ContentPostDocument> {
    const uid = new Types.ObjectId(userId);
    let teamId: Types.ObjectId | undefined;
    if (dto.team) {
      const team = await this.teamService.requireTeam(dto.team);
      this.teamService.assertOwner(team, userId);
      teamId = team._id;
    }

    let matchId: Types.ObjectId | undefined;
    let turfId: Types.ObjectId | undefined;
    if (dto.match) {
      const match = await requireTeamMatch(this.teamMatchModel, dto.match);
      assertMatchAllowsPhotoPosts(match);
      await assertUserCanPostForMatch(
        match,
        userId,
        this.teamService,
        this.teamMemberService,
      );
      if (teamId) {
        ensureMatchHasTeam(match, teamId);
      }
      matchId = match._id;
      turfId = resolveSelectedTurfId(match);
    }

    let location = dto.location as GeoLocation | undefined;
    if (!location && turfId) {
      const turf = await this.turfModel
        .findById(turfId)
        .select('location')
        .lean()
        .exec();
      if (turf?.location) {
        location = turf.location as GeoLocation;
      }
    }

    const mediaIds = await this.createMediaFromInputs(userId, dto.media);

    const doc = new this.postModel({
      postedBy: uid,
      team: teamId,
      match: matchId,
      turf: turfId,
      status: (dto.status as PostStatus) ?? PostStatus.DRAFT,
      title: dto.title ?? '',
      content: dto.content ?? '',
      tags: dto.tags ?? [],
      location,
      media: mediaIds,
    });

    const saved = await doc.save();

    const mediaUrls = dto.media?.map((m) => m.url) ?? [];
    if (mediaUrls.length > 0) {
      await this.storageLifecycle.syncUrlArrayOnEntitySave({
        userId,
        entityType: 'post',
        entityId: saved._id.toString(),
        previousUrls: [],
        nextUrls: mediaUrls,
      });
    }

    return (await saved.populate(PostService.populate)) as ContentPostDocument;
  }

  async findById(id: string, userId: string): Promise<ContentPostDocument> {
    const post = await this.postModel
      .findById(id)
      .populate(PostService.populate)
      .exec();
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    await this.assertCanViewPost(post, userId);
    return post;
  }

  /** Hydrate posts by id for explore feed session cache (order preserved). */
  async findByIdsForExplore(ids: string[]): Promise<ContentPostDocument[]> {
    if (!ids.length) return [];
    const oids = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!oids.length) return [];
    const docs = await this.postModel
      .find({ _id: { $in: oids } })
      .populate(PostService.populate)
      .exec();
    const order = new Map(ids.map((id, i) => [id, i]));
    docs.sort(
      (a, b) =>
        (order.get(a._id.toString()) ?? 0) - (order.get(b._id.toString()) ?? 0),
    );
    return docs;
  }

  async findMany(
    userId: string,
    filter: PostFilterDto,
    extra?: { excludeIds?: string[] },
  ): Promise<PaginatedResult<ContentPostDocument>> {
    const { page = 1, limit = 10 } = filter;
    const skip = (page - 1) * limit;

    const q = await this.buildListFilter(userId, filter);
    applyExcludeIds(q, extra?.excludeIds);

    const location = filter.location;
    const nearbyLat = location?.nearbyLat;
    const nearbyLng = location?.nearbyLng;
    // Soft distance: prefer closer; nearbyRadiusKm ignored; no-location included last.
    if (location && nearbyLat !== undefined && nearbyLng !== undefined) {
      return paginateSortedByDistance({
        model: this.postModel,
        geoKey: 'location.coordinates',
        location,
        match: q,
        page,
        limit,
        populate: PostService.populate,
        fallbackSort: { createdAt: -1 },
      });
    }

    const [data, totalDocuments] = await Promise.all([
      this.postModel
        .find(q)
        .populate(PostService.populate)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.postModel.countDocuments(q),
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
    dto: UpdatePostDto,
  ): Promise<ContentPostDocument> {
    const post = await this.postModel.findById(id);
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    await this.assertCanEditPost(post, userId);

    if (dto.title !== undefined) post.title = dto.title;
    if (dto.content !== undefined) post.content = dto.content;
    if (dto.tags !== undefined) post.tags = dto.tags;
    if (dto.status !== undefined) post.status = dto.status as PostStatus;

    if (dto.team !== undefined) {
      if (dto.team === null) {
        post.team = undefined;
      } else {
        const team = await this.teamService.requireTeam(dto.team);
        this.teamService.assertOwner(team, userId);
        if (post.match) {
          const match = await requireTeamMatch(
            this.teamMatchModel,
            resolveId(post.match),
          );
          ensureMatchHasTeam(match, team._id);
        }
        post.team = team._id;
      }
    }

    if (dto.location !== undefined) {
      if (dto.location === null) {
        post.location = undefined;
      } else {
        post.location = dto.location as GeoLocation;
      }
    }

    if (dto.media !== undefined) {
      const oldIds = post.media.map((m) => m.toString());
      let previousUrls: string[] = [];
      if (oldIds.length) {
        const oldMedia = await this.mediaModel
          .find({ _id: { $in: oldIds } })
          .select('url')
          .lean();
        previousUrls = oldMedia.map((m) => m.url);
        await this.mediaModel.deleteMany({ _id: { $in: oldIds } });
      }
      post.media = await this.createMediaFromInputs(userId, dto.media);

      await post.save();
      await this.storageLifecycle.syncUrlArrayOnEntitySave({
        userId,
        entityType: 'post',
        entityId: post._id.toString(),
        previousUrls,
        nextUrls: dto.media.map((m) => m.url),
      });

      return (await post.populate(PostService.populate)) as ContentPostDocument;
    } else if (dto.mediaIds !== undefined) {
      await this.assertMediaOwnedByUser(dto.mediaIds, userId);
      post.media = dto.mediaIds.map((id) => new Types.ObjectId(id));
    }

    await post.save();
    return (await post.populate(PostService.populate)) as ContentPostDocument;
  }

  async remove(id: string, userId: string): Promise<void> {
    const post = await this.postModel.findById(id);
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    await this.assertCanEditPost(post, userId);
    const mediaIds = post.media.map((m) => m.toString());
    const mediaDocs = mediaIds.length
      ? await this.mediaModel
          .find({ _id: { $in: mediaIds } })
          .select('url')
          .lean()
      : [];
    const mediaUrls = mediaDocs.map((m) => m.url);

    await this.postModel.findByIdAndDelete(id);
    if (mediaIds.length) {
      await this.mediaModel.deleteMany({ _id: { $in: mediaIds } });
    }
    if (mediaUrls.length > 0) {
      await this.storageLifecycle.deleteUrlsForUser(userId, mediaUrls);
    }
  }

  private async buildListFilter(
    userId: string,
    filter: PostFilterDto,
  ): Promise<Record<string, unknown>> {
    const q: Record<string, unknown> = {};

    if (filter.team) {
      q.team = new Types.ObjectId(filter.team);
    }
    if (filter.match) {
      q.match = new Types.ObjectId(filter.match);
    }
    if (filter.turf) {
      q.turf = new Types.ObjectId(filter.turf);
    }

    const viewingOwn = filter.mine === true;

    if (viewingOwn) {
      q.postedBy = new Types.ObjectId(userId);
      if (filter.status) {
        q.status = filter.status;
      }
    } else if (filter.postedBy !== undefined) {
      if (filter.postedBy !== userId && filter.status === PostStatus.DRAFT) {
        throw new ForbiddenException('Cannot list drafts for other users');
      }
      q.postedBy = new Types.ObjectId(filter.postedBy);
      if (filter.postedBy !== userId) {
        q.status =
          filter.status && filter.status !== PostStatus.DRAFT
            ? filter.status
            : { $in: [PostStatus.PUBLISHED, PostStatus.ARCHIVED] };
      } else if (filter.status) {
        q.status = filter.status;
      }
    } else if (filter.status === PostStatus.DRAFT) {
      q.postedBy = new Types.ObjectId(userId);
      q.status = PostStatus.DRAFT;
    } else if (filter.status) {
      q.status = filter.status;
    } else {
      q.status = { $in: [PostStatus.PUBLISHED, PostStatus.ARCHIVED] };
    }

    const search = filter.search?.trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      q.$or = [
        { title: searchRegex },
        { content: searchRegex },
        { tags: searchRegex },
      ];
    }

    if (filter.sportType) {
      const [teamIds, matchIds] = await Promise.all([
        this.teamModel.distinct('_id', { sportType: filter.sportType }),
        this.teamMatchModel.distinct('_id', { sportType: filter.sportType }),
      ]);
      const sportOr = [
        { team: { $in: teamIds } },
        { match: { $in: matchIds } },
      ];
      const existingOr = q.$or;
      if (existingOr) {
        q.$and = [{ $or: existingOr }, { $or: sportOr }];
        delete q.$or;
      } else {
        q.$or = sportOr;
      }
    }

    return q;
  }

  private async createMediaFromInputs(
    userId: string,
    items: CreatePostDto['media'],
  ): Promise<Types.ObjectId[]> {
    if (!items?.length) {
      return [];
    }
    const uid = new Types.ObjectId(userId);
    const docs = await this.mediaModel.insertMany(
      items.map((m) => ({
        url: m.url,
        kind: m.kind as MediaKind,
        caption: m.caption,
        uploadedBy: uid,
      })),
    );
    return docs.map((d) => d._id);
  }

  private async assertMediaOwnedByUser(
    ids: string[],
    userId: string,
  ): Promise<void> {
    if (!ids.length) {
      return;
    }
    const uid = new Types.ObjectId(userId);
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const count = await this.mediaModel.countDocuments({
      _id: { $in: objectIds },
      uploadedBy: uid,
    });
    if (count !== ids.length) {
      throw new BadRequestException(
        'All media must exist and belong to the current user',
      );
    }
  }

  private async assertCanViewPost(
    post: ContentPostDocument,
    userId: string,
  ): Promise<void> {
    if (post.status !== PostStatus.DRAFT) {
      return;
    }
    if (resolveId(post.postedBy) === resolveId(userId)) {
      return;
    }
    if (post.team) {
      const team = await this.teamService.requireTeam(post.team.toString());
      if (this.teamService.isOwner(team, userId)) {
        return;
      }
    }
    throw new ForbiddenException('You cannot view this draft post');
  }

  private async assertCanEditPost(
    post: ContentPostDocument,
    userId: string,
  ): Promise<void> {
    if (resolveId(post.postedBy) === resolveId(userId)) {
      return;
    }
    if (post.team) {
      const team = await this.teamService.requireTeam(post.team.toString());
      if (this.teamService.isOwner(team, userId)) {
        return;
      }
    }
    throw new ForbiddenException('You cannot modify this post');
  }
}
