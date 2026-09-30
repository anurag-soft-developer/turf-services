import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DAILY_POST_LIMIT,
  DAILY_UPLOAD_BYTES_LIMIT,
  DAILY_UPLOAD_FILE_LIMIT,
} from './usage-quota.constants';
import {
  UnusedUploadRegistry,
  UnusedUploadRegistryDocument,
} from '../storage/schemas/unused-upload-registry.schema';
import {
  DailyUsageQuota,
  DailyUsageQuotaDocument,
} from './schemas/daily-usage-quota.schema';
import {
  isDuplicateKey,
  quotaExpiresAt,
  usageDayKey,
} from './util/usage-quota.util';

@Injectable()
export class UsageQuotaService {
  constructor(
    @InjectModel(DailyUsageQuota.name)
    private readonly quotaModel: Model<DailyUsageQuotaDocument>,
    @InjectModel(UnusedUploadRegistry.name)
    private readonly uploadRegistryModel: Model<UnusedUploadRegistryDocument>,
  ) {}

  async consumePost(userId: string): Promise<void> {
    const consumed = await this.tryIncrement(userId, { postsCreated: 1 }, {
      postsCreated: DAILY_POST_LIMIT - 1,
    });
    if (!consumed) {
      throw new HttpException(
        'Daily post limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async releasePost(userId: string): Promise<void> {
    await this.tryDecrement(userId, { postsCreated: 1 }, { postsCreated: 1 });
  }

  /** Returns false when `objectKey` was already registered and quota was not consumed. */
  async consumeUpload(params: {
    userId: string;
    sizeBytes: number;
    objectKey?: string;
  }): Promise<boolean> {
    if (params.objectKey) {
      const existing = await this.uploadRegistryModel
        .exists({ objectKey: params.objectKey })
        .exec();
      if (existing != null) {
        return false;
      }
    }

    const consumed = await this.tryIncrement(
      params.userId,
      {
        uploadsCount: 1,
        uploadBytes: params.sizeBytes,
      },
      {
        uploadsCount: DAILY_UPLOAD_FILE_LIMIT - 1,
        uploadBytes: DAILY_UPLOAD_BYTES_LIMIT - params.sizeBytes,
      },
    );
    if (!consumed) {
      throw new HttpException(
        'Daily upload limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  async releaseUpload(params: {
    userId: string;
    sizeBytes: number;
  }): Promise<void> {
    await this.tryDecrement(
      params.userId,
      {
        uploadsCount: 1,
        uploadBytes: params.sizeBytes,
      },
      {
        uploadsCount: 1,
        uploadBytes: params.sizeBytes,
      },
    );
  }

  private async tryIncrement(
    userId: string,
    increments: Record<string, number>,
    maxBeforeIncrement: Record<string, number>,
  ): Promise<boolean> {
    const dayKey = usageDayKey();
    const userObjectId = new Types.ObjectId(userId);
    await this.ensureToday(userObjectId, dayKey);

    const filter: Record<string, unknown> = {
      userId: userObjectId,
      dayKey,
    };
    for (const [field, max] of Object.entries(maxBeforeIncrement)) {
      filter[field] = { $lte: max };
    }

    const updated = await this.quotaModel.findOneAndUpdate(
      filter,
      { $inc: increments },
      { new: true },
    );
    return updated != null;
  }

  private async tryDecrement(
    userId: string,
    decrements: Record<string, number>,
    minimums: Record<string, number>,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      dayKey: usageDayKey(),
    };
    const inc: Record<string, number> = {};
    for (const [field, amount] of Object.entries(decrements)) {
      filter[field] = { $gte: minimums[field] ?? amount };
      inc[field] = -amount;
    }
    await this.quotaModel.updateOne(filter, { $inc: inc });
  }

  /**
   * Insert today's counters at zero so the conditional `$inc` can match.
   * Concurrent first requests may hit the unique index.
   */
  private async ensureToday(
    userId: Types.ObjectId,
    dayKey: string,
  ): Promise<void> {
    try {
      await this.quotaModel.updateOne(
        { userId, dayKey },
        {
          $setOnInsert: {
            userId,
            dayKey,
            postsCreated: 0,
            uploadsCount: 0,
            uploadBytes: 0,
            expiresAt: quotaExpiresAt(dayKey),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
    }
  }
}
