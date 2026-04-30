import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { TurfDocument } from '../../turf/schemas/turf.schema';

class TurfBookingStatsUtility {
  static formatTrendPercentage(current: number, previous: number): string {
    if (!previous && !current) {
      return '+0%';
    }

    if (!previous && current > 0) {
      return '+100%';
    }

    const trend = ((current - previous) / previous) * 100;
    const roundedTrend = Math.round(trend);

    if (roundedTrend > 0) {
      return `+${roundedTrend}%`;
    }

    return `${roundedTrend}%`;
  }

  static async resolveAndValidateTurfIds(
    turfModel: Model<TurfDocument>,
    ownerId: string,
    turfIds?: string[],
  ): Promise<Types.ObjectId[]> {
    const requestedTurfIds = (turfIds ?? []).filter(Boolean);

    if (requestedTurfIds.length === 0) {
      const ownedTurfs = await turfModel
        .find({ postedBy: ownerId })
        .select('_id');
      return ownedTurfs.map((turf) => turf._id);
    }

    const invalidTurfId = requestedTurfIds.find(
      (turfId) => !Types.ObjectId.isValid(turfId),
    );
    if (invalidTurfId) {
      throw new BadRequestException(`Invalid turf id: ${invalidTurfId}`);
    }

    const uniqueTurfIds = [...new Set(requestedTurfIds)];
    const objectIds = uniqueTurfIds.map((turfId) => new Types.ObjectId(turfId));

    const turfs = await turfModel
      .find({ _id: { $in: objectIds } })
      .select('_id postedBy');

    if (turfs.length !== objectIds.length) {
      throw new NotFoundException('One or more turfs do not exist');
    }

    const unauthorizedTurf = turfs.find(
      (turf) => turf.postedBy.toString() !== ownerId,
    );
    if (unauthorizedTurf) {
      throw new ForbiddenException(
        'You can only view booking stats for your own turfs',
      );
    }

    return objectIds;
  }
}

export default TurfBookingStatsUtility;
