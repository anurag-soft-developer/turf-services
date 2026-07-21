import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Following,
  FollowingDocument,
  FollowingStatus,
  FollowTargetType,
} from './schemas/following.schema';
import {
  FollowingFilterDto,
  FriendsPaginationDto,
  SendFollowingRequestDto,
} from './dto/following.dto';
import { resolveId } from '../core/utils/mongo-ref.util';
import { PaginatedResult } from '../core/interfaces/common';
import { buildMongoSortOptions } from '../core/utils/mongo-sort.util';
import { User, UserDocument, userSelectFields } from '../users/schemas/user.schema';
import { Team, TeamDocument } from '../team/schemas/team.schema';
import { NotificationService } from '../notification/notification.service';
import {
  notifyFollowingResolved,
  notifyNewFollower,
} from './utility/followings-notification.utility';
import { FollowingsUtility } from './utility/followings.utility';

const REJECTED_TTL_MS = 24 * 60 * 60 * 1000;

const recipientPopulateSelect =
  '_id fullName avatar email name logo location sportType';

@Injectable()
export class FollowingsService {
  static readonly populatePaths = [
    { path: 'requester', select: userSelectFields },
    { path: 'recipient', select: recipientPopulateSelect },
  ];

  constructor(
    @InjectModel(Following.name)
    private followingModel: Model<FollowingDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(Team.name)
    private teamModel: Model<TeamDocument>,
    private readonly notificationService: NotificationService,
  ) {}

  async sendRequest(
    userId: string,
    dto: SendFollowingRequestDto,
  ): Promise<FollowingDocument> {
    const recipientType = dto.recipientType as FollowTargetType;

    if (
      recipientType === FollowTargetType.USER &&
      dto.recipientId === userId
    ) {
      throw new BadRequestException('Cannot follow yourself');
    }

    await FollowingsUtility.validateFollowTarget(
      this.userModel,
      this.teamModel,
      dto.recipientId,
      recipientType,
    );

    const recipientOid = new Types.ObjectId(dto.recipientId);

    const existingSame = await this.followingModel.findOne({
      requester: userId,
      recipient: recipientOid,
      recipientType,
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

    const doc = await this.followingModel.create({
      requester: userId,
      recipient: recipientOid,
      recipientType,
      status: FollowingStatus.ACCEPTED,
    });

    await FollowingsUtility.applyAcceptedFollowingCounts(
      this.userModel,
      this.teamModel,
      doc,
    );

    if (recipientType === FollowTargetType.USER) {
      await notifyNewFollower(this.notificationService, {
        recipientUserId: dto.recipientId,
        followingId: doc._id.toString(),
        requesterUserId: userId,
      });
    }

    return (await doc.populate(
      FollowingsService.populatePaths,
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

    if (following.recipientType !== FollowTargetType.USER) {
      throw new BadRequestException('Only user follow requests can be resolved');
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
      await following.save();
      await FollowingsUtility.applyAcceptedFollowingCounts(
        this.userModel,
        this.teamModel,
        following,
      );
    } else {
      following.status = FollowingStatus.REJECTED;
      following.purgeAt = new Date(Date.now() + REJECTED_TTL_MS);
      await following.save();
    }

    await notifyFollowingResolved(this.notificationService, {
      recipientUserId: following.requester.toString(),
      followingId: following._id.toString(),
      accepted: status === FollowingStatus.ACCEPTED,
    });

    return (await following.populate(
      FollowingsService.populatePaths,
    )) as FollowingDocument;
  }

  async closeFollowing(followingId: string, userId: string): Promise<void> {
    const following = await this.followingModel.findById(followingId);
    if (!following) {
      throw new NotFoundException('Following not found');
    }

    const isRequester = resolveId(following.requester) === resolveId(userId);
    const isUserRecipient =
      following.recipientType === FollowTargetType.USER &&
      resolveId(following.recipient) === resolveId(userId);

    if (!isRequester && !isUserRecipient) {
      throw new ForbiddenException('Not a participant in this following');
    }

    if (following.status === FollowingStatus.ACCEPTED) {
      await FollowingsUtility.revertAcceptedFollowingCounts(
        this.userModel,
        this.teamModel,
        following,
      );
    }

    await this.followingModel.findByIdAndDelete(followingId);
  }

  async listMine(
    userId: string,
    filter: FollowingFilterDto,
  ): Promise<PaginatedResult<FollowingDocument>> {
    const {
      status,
      direction = 'all',
      recipientType,
      recipientId,
      page = 1,
      limit = 20,
    } = filter;

    const uid = new Types.ObjectId(userId);
    const base: Record<string, unknown> = {};

    if (status) {
      base.status = status;
    }

    if (recipientType) {
      base.recipientType = recipientType;
    }

    if (recipientId) {
      base.recipient = new Types.ObjectId(recipientId);
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

    return this.paginateFollowingEdges(filterQuery, page, limit);
  }

  async listUserFollowers(
    targetUserId: string,
    pagination: FriendsPaginationDto,
  ): Promise<PaginatedResult<FollowingDocument>> {
    const { page = 1, limit = 20 } = pagination;
    return this.paginateFollowingEdges(
      {
        recipient: new Types.ObjectId(targetUserId),
        recipientType: FollowTargetType.USER,
        status: FollowingStatus.ACCEPTED,
      },
      page,
      limit,
    );
  }

  async listUserFollowing(
    targetUserId: string,
    pagination: FriendsPaginationDto,
  ): Promise<PaginatedResult<FollowingDocument>> {
    const { page = 1, limit = 20 } = pagination;
    return this.paginateFollowingEdges(
      {
        requester: new Types.ObjectId(targetUserId),
        recipientType: FollowTargetType.USER,
        status: FollowingStatus.ACCEPTED,
      },
      page,
      limit,
    );
  }

  async listTeamFollowers(
    targetTeamId: string,
    pagination: FriendsPaginationDto,
  ): Promise<PaginatedResult<FollowingDocument>> {
    const { page = 1, limit = 20 } = pagination;
    return this.paginateFollowingEdges(
      {
        recipient: new Types.ObjectId(targetTeamId),
        recipientType: FollowTargetType.TEAM,
        status: FollowingStatus.ACCEPTED,
      },
      page,
      limit,
    );
  }

  private async paginateFollowingEdges(
    filterQuery: Record<string, unknown>,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<FollowingDocument>> {
    const skip = (page - 1) * limit;

    const [data, totalDocuments] = await Promise.all([
      this.followingModel
        .find(filterQuery)
        .populate(FollowingsService.populatePaths)
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
    return FollowingsUtility.paginateMutualFriends(
      this.followingModel,
      this.userModel,
      new Types.ObjectId(userId),
      page,
      limit,
    );
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
    return FollowingsUtility.paginateMutualFriends(
      this.followingModel,
      this.userModel,
      new Types.ObjectId(userId),
      page,
      limit,
      new Types.ObjectId(otherUserId),
    );
  }

  // async areConnected(userIdA: string, userIdB: string): Promise<boolean> {
  //   if (userIdA === userIdB) {
  //     return true;
  //   }

  //   const a = new Types.ObjectId(userIdA);
  //   const b = new Types.ObjectId(userIdB);

  //   const found = await this.followingModel.exists({
  //     status: FollowingStatus.ACCEPTED,
  //     recipientType: FollowTargetType.USER,
  //     $or: [
  //       { requester: a, recipient: b },
  //       { requester: b, recipient: a },
  //     ],
  //   });

  //   return !!found;
  // }

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
      recipientType: FollowTargetType.USER,
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
      .populate(FollowingsService.populatePaths)
      .exec();
  }
}
