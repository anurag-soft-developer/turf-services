import { NotFoundException } from '@nestjs/common';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  Following,
  FollowingDocument,
  FollowingStatus,
  FollowTargetType,
} from '../schemas/following.schema';
import { PaginatedResult } from '../../core/interfaces/common';
import { UserDocument } from '../../users/schemas/user.schema';
import { TeamDocument } from '../../team/schemas/team.schema';

export class FollowingsUtility {
  static async validateFollowTarget(
    userModel: Model<UserDocument>,
    teamModel: Model<TeamDocument>,
    recipientId: string,
    recipientType: FollowTargetType,
  ): Promise<void> {
    if (recipientType === FollowTargetType.USER) {
      const user = await userModel.exists({ _id: recipientId });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      return;
    }

    if (recipientType === FollowTargetType.TEAM) {
      const team = await teamModel.exists({ _id: recipientId });
      if (!team) {
        throw new NotFoundException('Team not found');
      }
    }
  }

  static async applyAcceptedFollowingCounts(
    userModel: Model<UserDocument>,
    teamModel: Model<TeamDocument>,
    following: Pick<Following, 'requester' | 'recipient' | 'recipientType'>,
  ): Promise<void> {
    await userModel.updateOne(
      { _id: following.requester },
      { $inc: { followingCount: 1 } },
    );

    if (following.recipientType === FollowTargetType.USER) {
      await userModel.updateOne(
        { _id: following.recipient },
        { $inc: { followerCount: 1 } },
      );
      return;
    }

    if (following.recipientType === FollowTargetType.TEAM) {
      await teamModel.updateOne(
        { _id: following.recipient },
        { $inc: { followerCount: 1 } },
      );
    }
  }

  static async revertAcceptedFollowingCounts(
    userModel: Model<UserDocument>,
    teamModel: Model<TeamDocument>,
    following: Pick<Following, 'requester' | 'recipient' | 'recipientType'>,
  ): Promise<void> {
    await userModel.updateOne(
      { _id: following.requester, followingCount: { $gte: 1 } },
      { $inc: { followingCount: -1 } },
    );

    if (following.recipientType === FollowTargetType.USER) {
      await userModel.updateOne(
        { _id: following.recipient, followerCount: { $gte: 1 } },
        { $inc: { followerCount: -1 } },
      );
      return;
    }

    if (following.recipientType === FollowTargetType.TEAM) {
      await teamModel.updateOne(
        { _id: following.recipient, followerCount: { $gte: 1 } },
        { $inc: { followerCount: -1 } },
      );
    }
  }

  /**
   * Friends = accepted followings in both directions.
   * Intersection + pagination run in MongoDB; only one page of users is returned.
   * When `alsoFriendsWith` is set, candidates must also be mutual friends with that user.
   */
  static async paginateMutualFriends(
    followingModel: Model<FollowingDocument>,
    userModel: Model<UserDocument>,
    userId: Types.ObjectId,
    page: number,
    limit: number,
    alsoFriendsWith?: Types.ObjectId,
  ): Promise<PaginatedResult<UserDocument>> {
    const skip = (page - 1) * limit;
    const followingsCollection = followingModel.collection.name;
    const usersCollection = userModel.collection.name;

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
                  { $eq: ['$recipientType', FollowTargetType.USER] },
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
                  { $eq: ['$recipientType', FollowTargetType.USER] },
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
          recipientType: FollowTargetType.USER,
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

    const [result] = await followingModel.aggregate<{
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
}
