import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  Following,
  FollowingDocument,
  FollowingStatus,
} from './schemas/following.schema';
import {
  ConnectionFilterDto,
  FriendsPaginationDto,
  SendConnectionRequestDto,
} from './dto/connection.dto';
import { resolveId } from '../core/utils/mongo-ref.util';
import { PaginatedResult } from '../core/interfaces/common';
import { buildMongoSortOptions } from '../core/utils/mongo-sort.util';
import { User, UserDocument, userSelectFields } from '../users/schemas/user.schema';
import { NotificationService } from '../notification/notification.service';
import {
  notifyFollowingRequest,
  notifyFollowingResolved,
} from './utility/followings-notification.utility';

const REJECTED_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class FollowingsService {
  static readonly userPopulate = [
    { path: 'requester', select: userSelectFields },
    { path: 'recipient', select: userSelectFields },
  ];

  constructor(
    @InjectModel(Following.name)
    private followingModel: Model<FollowingDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private readonly notificationService: NotificationService,
  ) {}

  async sendRequest(
    userId: string,
    dto: SendConnectionRequestDto,
  ): Promise<FollowingDocument> {
    if (dto.recipientId === userId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    const recipientOid = new Types.ObjectId(dto.recipientId);

    const existingSame = await this.followingModel.findOne({
      requester: userId,
      recipient: recipientOid,
    });

    if (existingSame) {
      if (existingSame.status === FollowingStatus.PENDING) {
        throw new ConflictException('Following request already sent');
      }
      if (existingSame.status === FollowingStatus.ACCEPTED) {
        throw new ConflictException('Already following');
      }
      if (existingSame.status === FollowingStatus.REJECTED) {
        throw new ConflictException(
          'Request was rejected; try again after the record expires',
        );
      }
    }

    const reverse = await this.followingModel.findOne({
      requester: recipientOid,
      recipient: userId,
    });

    if (reverse) {
      if (reverse.status === FollowingStatus.PENDING) {
        throw new ConflictException(
          'This user has already sent you a request; accept or reject it',
        );
      }
      if (reverse.status === FollowingStatus.ACCEPTED) {
        throw new ConflictException('Already following');
      }
    }

    const doc = await this.followingModel.create({
      requester: userId,
      recipient: recipientOid,
      status: FollowingStatus.PENDING,
    });

    await notifyFollowingRequest(this.notificationService, {
      recipientUserId: dto.recipientId,
      followingId: doc._id.toString(),
      requesterUserId: userId,
    });

    return (await doc.populate(
      FollowingsService.userPopulate,
    )) as FollowingDocument;
  }

  async resolveRequest(
    followingId: string,
    userId: string,
    status: FollowingStatus.ACCEPTED | FollowingStatus.REJECTED,
  ): Promise<FollowingDocument> {
    const following = await this.followingModel.findById(followingId);
    if (!following) {
      throw new NotFoundException('Following request not found');
    }

    if (resolveId(following.recipient) !== resolveId(userId)) {
      throw new ForbiddenException(
        'Only the recipient can resolve this request',
      );
    }

    if (following.status !== FollowingStatus.PENDING) {
      throw new BadRequestException('Request is no longer pending');
    }

    if (status === FollowingStatus.ACCEPTED) {
      following.status = FollowingStatus.ACCEPTED;
      following.purgeAt = undefined;
    } else {
      following.status = FollowingStatus.REJECTED;
      following.purgeAt = new Date(Date.now() + REJECTED_TTL_MS);
    }

    await following.save();

    await notifyFollowingResolved(this.notificationService, {
      recipientUserId: following.requester.toString(),
      followingId: following._id.toString(),
      accepted: status === FollowingStatus.ACCEPTED,
    });

    return (await following.populate(
      FollowingsService.userPopulate,
    )) as FollowingDocument;
  }

  async closeFollowing(followingId: string, userId: string): Promise<void> {
    const following = await this.followingModel.findById(followingId);
    if (!following) {
      throw new NotFoundException('Following not found');
    }

    const isParticipant =
      resolveId(following.requester) === resolveId(userId) ||
      resolveId(following.recipient) === resolveId(userId);

    if (!isParticipant) {
      throw new ForbiddenException('Not a participant in this following');
    }

    await this.followingModel.findByIdAndDelete(followingId);
  }

  async listMine(
    userId: string,
    filter: ConnectionFilterDto,
  ): Promise<PaginatedResult<FollowingDocument>> {
    const { status, direction = 'all', page = 1, limit = 20 } = filter;

    const uid = new Types.ObjectId(userId);
    const base: Record<string, unknown> = {};

    if (status) {
      base.status = status;
    }

    let filterQuery: Record<string, unknown> = {};

    if (direction === 'incoming') {
      filterQuery = { ...base, recipient: uid };
    } else if (direction === 'outgoing') {
      filterQuery = { ...base, requester: uid };
    } else {
      filterQuery = {
        ...base,
        $or: [{ requester: uid }, { recipient: uid }],
      };
    }

    const skip = (page - 1) * limit;

    const [data, totalDocuments] = await Promise.all([
      this.followingModel
        .find(filterQuery)
        .populate(FollowingsService.userPopulate)
        .sort(
          buildMongoSortOptions(undefined, {
            defaultSort: { updatedAt: -1 },
            whenParsedEmpty: 'default',
          }),
        )
        .skip(skip)
        .limit(limit)
        .exec(),
      this.followingModel.countDocuments(filterQuery),
    ]);

    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async listFriends(
    userId: string,
    pagination: FriendsPaginationDto,
  ): Promise<PaginatedResult<UserDocument>> {
    const { page = 1, limit = 20 } = pagination;
    return this.paginateMutualFriends(new Types.ObjectId(userId), page, limit);
  }

  async listMutualFriendsWith(
    userId: string,
    otherUserId: string,
    pagination: FriendsPaginationDto,
  ): Promise<PaginatedResult<UserDocument>> {
    if (userId === otherUserId) {
      throw new BadRequestException(
        'Cannot list mutual friends with yourself',
      );
    }

    const { page = 1, limit = 20 } = pagination;
    return this.paginateMutualFriends(
      new Types.ObjectId(userId),
      page,
      limit,
      new Types.ObjectId(otherUserId),
    );
  }

  /**
   * Friends = accepted followings in both directions.
   * Intersection + pagination run in MongoDB; only one page of users is returned.
   * When `alsoFriendsWith` is set, candidates must also be mutual friends with that user.
   */
  private async paginateMutualFriends(
    userId: Types.ObjectId,
    page: number,
    limit: number,
    alsoFriendsWith?: Types.ObjectId,
  ): Promise<PaginatedResult<UserDocument>> {
    const skip = (page - 1) * limit;
    const followingsCollection = this.followingModel.collection.name;
    const usersCollection = this.userModel.collection.name;

    const reverseEdgeExists = (
      localFriendField: string,
      againstUser: Types.ObjectId,
      as: string,
    ): PipelineStage.Lookup => ({
      $lookup: {
        from: followingsCollection,
        let: { friendId: `$${localFriendField}` },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$requester', '$$friendId'] },
                  { $eq: ['$recipient', againstUser] },
                  { $eq: ['$status', FollowingStatus.ACCEPTED] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as,
      },
    });

    const forwardEdgeExists = (
      localFriendField: string,
      fromUser: Types.ObjectId,
      as: string,
    ): PipelineStage.Lookup => ({
      $lookup: {
        from: followingsCollection,
        let: { friendId: `$${localFriendField}` },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$requester', fromUser] },
                  { $eq: ['$recipient', '$$friendId'] },
                  { $eq: ['$status', FollowingStatus.ACCEPTED] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as,
      },
    });

    const pipeline: PipelineStage[] = [
      {
        $match: {
          requester: userId,
          status: FollowingStatus.ACCEPTED,
        },
      },
      reverseEdgeExists('recipient', userId, 'followsBack'),
      { $match: { 'followsBack.0': { $exists: true } } },
    ];

    if (alsoFriendsWith) {
      pipeline.push(
        reverseEdgeExists('recipient', alsoFriendsWith, 'followsOther'),
        forwardEdgeExists('recipient', alsoFriendsWith, 'followedByOther'),
        {
          $match: {
            'followsOther.0': { $exists: true },
            'followedByOther.0': { $exists: true },
          },
        },
      );
    }

    pipeline.push(
      {
        $lookup: {
          from: usersCollection,
          localField: 'recipient',
          foreignField: '_id',
          as: 'user',
          pipeline: [
            {
              $project: {
                _id: 1,
                fullName: 1,
                avatar: 1,
                email: 1,
              },
            },
          ],
        },
      },
      { $unwind: '$user' },
      { $sort: { 'user.fullName': 1 } },
      {
        $facet: {
          meta: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            { $replaceRoot: { newRoot: '$user' } },
          ],
        },
      },
    );

    const [result] = await this.followingModel.aggregate<{
      meta: Array<{ total: number }>;
      data: UserDocument[];
    }>(pipeline);

    const totalDocuments = result?.meta[0]?.total ?? 0;

    return {
      data: result?.data ?? [],
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async areConnected(userIdA: string, userIdB: string): Promise<boolean> {
    if (userIdA === userIdB) {
      return true;
    }

    const a = new Types.ObjectId(userIdA);
    const b = new Types.ObjectId(userIdB);

    const found = await this.followingModel.exists({
      status: FollowingStatus.ACCEPTED,
      $or: [
        { requester: a, recipient: b },
        { requester: b, recipient: a },
      ],
    });

    return !!found;
  }

  async isConnectedToAny(
    userId: string,
    otherUserIds: Types.ObjectId[],
  ): Promise<boolean> {
    if (!otherUserIds.length) {
      return false;
    }

    const uid = new Types.ObjectId(userId);
    const found = await this.followingModel.exists({
      status: FollowingStatus.ACCEPTED,
      $or: [
        { requester: uid, recipient: { $in: otherUserIds } },
        { recipient: uid, requester: { $in: otherUserIds } },
      ],
    });

    return !!found;
  }

  async findById(id: string): Promise<FollowingDocument | null> {
    return this.followingModel
      .findById(id)
      .populate(FollowingsService.userPopulate)
      .exec();
  }
}
