import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ContentPost, ContentPostDocument, PostStatus } from './schemas/content-post.schema';
import { Media, MediaDocument, MediaKind } from './schemas/media.schema';
import {
  CreateMediaDto,
  CreatePostDto,
  PostFilterDto,
  UpdatePostDto,
} from './dto/post.dto';
import { TeamService } from '../team/team.service';
import { PaginatedResult } from '../core/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';
import { GeoLocation } from '../core/schemas/geo-location.schema';

@Injectable()
export class PostService {
  private static readonly populate = [
    { path: 'postedBy', select: userSelectFields },
    {
      path: 'team',
      select: '_id name logo sportType visibility status',
    },
    { path: 'media' },
  ];

  constructor(
    @InjectModel(ContentPost.name)
    private postModel: Model<ContentPostDocument>,
    @InjectModel(Media.name)
    private mediaModel: Model<MediaDocument>,
    private teamService: TeamService,
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

  async create(userId: string, dto: CreatePostDto): Promise<ContentPostDocument> {
    const uid = new Types.ObjectId(userId);
    let teamId: Types.ObjectId | undefined;
    if (dto.team) {
      const team = await this.teamService.requireTeam(dto.team);
      this.teamService.assertOwner(team, userId);
      teamId = team._id;
    }

    const mediaIds = await this.createMediaFromInputs(userId, dto.media);

    const doc = new this.postModel({
      postedBy: uid,
      team: teamId,
      status: (dto.status as PostStatus) ?? PostStatus.DRAFT,
      title: dto.title ?? '',
      content: dto.content ?? '',
      tags: dto.tags ?? [],
      location: dto.location as GeoLocation | undefined,
      media: mediaIds,
    });

    const saved = await doc.save();
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

  async findMany(
    userId: string,
    filter: PostFilterDto,
  ): Promise<PaginatedResult<ContentPostDocument>> {
    const { page = 1, limit = 10 } = filter;
    const skip = (page - 1) * limit;

    const q = this.buildListFilter(userId, filter);

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
      if (oldIds.length) {
        await this.mediaModel.deleteMany({ _id: { $in: oldIds } });
      }
      post.media = await this.createMediaFromInputs(userId, dto.media);
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
    await this.postModel.findByIdAndDelete(id);
    if (mediaIds.length) {
      await this.mediaModel.deleteMany({ _id: { $in: mediaIds } });
    }
  }

  private buildListFilter(
    userId: string,
    filter: PostFilterDto,
  ): Record<string, unknown> {
    const q: Record<string, unknown> = {};

    if (filter.team) {
      q.team = new Types.ObjectId(filter.team);
    }

    const viewingOwn = filter.mine === true;

    if (viewingOwn) {
      q.postedBy = new Types.ObjectId(userId);
      if (filter.status) {
        q.status = filter.status;
      }
      return q;
    }

    if (filter.postedBy !== undefined) {
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
      return q;
    }

    if (filter.status === PostStatus.DRAFT) {
      q.postedBy = new Types.ObjectId(userId);
      q.status = PostStatus.DRAFT;
      return q;
    }

    if (filter.status) {
      q.status = filter.status;
    } else {
      q.status = { $in: [PostStatus.PUBLISHED, PostStatus.ARCHIVED] };
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
    return docs.map((d) => d._id as Types.ObjectId);
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
    if (post.postedBy.toString() === userId) {
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
    if (post.postedBy.toString() === userId) {
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
