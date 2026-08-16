import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RedisService } from '../core/redis/redis.service';
import {
  ContentStats,
  ContentStatsDocument,
} from './schemas/content-stats.schema';
import { Like, LikeDocument } from './schemas/like.schema';
import type { EngagementBatchDto, LikeBodyDto } from './dto/engagement.dto';
import {
  ENGAGEMENT_DEDUPE_TTL_SECONDS,
  engageDedupeKey,
  statsRedisKey,
  type EngagementEntityType,
} from './engagement.constants';

export type EntityStats = {
  impressions: number;
  views: number;
  watchMs: number;
  likeCount: number;
};

const EMPTY_STATS: EntityStats = {
  impressions: 0,
  views: 0,
  watchMs: 0,
  likeCount: 0,
};

@Injectable()
export class EngagementService {
  private readonly logger = new Logger(EngagementService.name);

  constructor(
    @InjectModel(ContentStats.name)
    private readonly statsModel: Model<ContentStatsDocument>,
    @InjectModel(Like.name)
    private readonly likeModel: Model<LikeDocument>,
    private readonly redis: RedisService,
  ) {}

  async ingestBatch(userId: string, dto: EngagementBatchDto): Promise<void> {
    for (const event of dto.events) {
      if (!Types.ObjectId.isValid(event.entityId)) continue;
      const kind = event.kind;
      const acquired = await this.redis.setNxEx(
        engageDedupeKey(userId, event.entityType, event.entityId, kind),
        ENGAGEMENT_DEDUPE_TTL_SECONDS,
      );
      if (!acquired) continue;

      const key = statsRedisKey(event.entityType, event.entityId);
      if (kind === 'impression') {
        await this.redis.incrHashField(key, 'impressions', 1);
      } else if (kind === 'view') {
        await this.redis.incrHashField(key, 'views', 1);
      } else if (kind === 'watch') {
        const ms = event.watchMs ?? 0;
        if (ms > 0) {
          await this.redis.incrHashField(key, 'watchMs', ms);
        }
      }
    }
  }

  async like(userId: string, dto: LikeBodyDto): Promise<{ liked: true }> {
    const entityId = new Types.ObjectId(dto.entityId);
    const userOid = new Types.ObjectId(userId);
    try {
      await this.likeModel.create({
        userId: userOid,
        entityType: dto.entityType,
        entityId,
      });
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code === 11000) {
        return { liked: true };
      }
      throw err;
    }
    await this.adjustLikeCount(dto.entityType, entityId, 1);
    return { liked: true };
  }

  async unlike(userId: string, dto: LikeBodyDto): Promise<{ liked: false }> {
    const entityId = new Types.ObjectId(dto.entityId);
    const deleted = await this.likeModel.findOneAndDelete({
      userId: new Types.ObjectId(userId),
      entityType: dto.entityType,
      entityId,
    });
    if (deleted) {
      await this.adjustLikeCount(dto.entityType, entityId, -1);
    }
    return { liked: false };
  }

  async getStatsMap(
    refs: { entityType: EngagementEntityType; entityId: string }[],
  ): Promise<Map<string, EntityStats>> {
    const map = new Map<string, EntityStats>();
    if (!refs.length) return map;

    const byType = new Map<EngagementEntityType, Types.ObjectId[]>();
    for (const ref of refs) {
      if (!Types.ObjectId.isValid(ref.entityId)) continue;
      const list = byType.get(ref.entityType) ?? [];
      list.push(new Types.ObjectId(ref.entityId));
      byType.set(ref.entityType, list);
    }

    const orClauses = [...byType.entries()].map(([entityType, ids]) => ({
      entityType,
      entityId: { $in: ids },
    }));

    const docs =
      orClauses.length === 0
        ? []
        : await this.statsModel.find({ $or: orClauses }).lean().exec();

    for (const doc of docs) {
      const key = `${doc.entityType}:${doc.entityId.toString()}`;
      map.set(key, {
        impressions: doc.impressions ?? 0,
        views: doc.views ?? 0,
        watchMs: doc.watchMs ?? 0,
        likeCount: doc.likeCount ?? 0,
      });
    }

    const hashes = await this.redis.hGetAllMany(
      refs.map((ref) => statsRedisKey(ref.entityType, ref.entityId)),
    );
    refs.forEach((ref, i) => {
      const hash = hashes[i] ?? {};
      const mapKey = `${ref.entityType}:${ref.entityId}`;
      const base = map.get(mapKey) ?? { ...EMPTY_STATS };
      map.set(mapKey, {
        impressions: base.impressions + toInt(hash.impressions),
        views: base.views + toInt(hash.views),
        watchMs: base.watchMs + toInt(hash.watchMs),
        likeCount: base.likeCount,
      });
    });

    return map;
  }

  async flushRedisStatsToMongo(): Promise<number> {
    const keys = await this.redis.scanKeys('stats:*');
    let flushed = 0;
    for (const key of keys) {
      const parsed = parseStatsKey(key);
      if (!parsed) continue;
      const hash = await this.redis.hGetAll(key);
      const impressions = toInt(hash.impressions);
      const views = toInt(hash.views);
      const watchMs = toInt(hash.watchMs);
      if (impressions === 0 && views === 0 && watchMs === 0) {
        await this.redis.del(key);
        continue;
      }
      try {
        await this.statsModel.updateOne(
          { entityType: parsed.entityType, entityId: parsed.entityId },
          {
            $inc: {
              ...(impressions ? { impressions } : {}),
              ...(views ? { views } : {}),
              ...(watchMs ? { watchMs } : {}),
            },
            $setOnInsert: {
              entityType: parsed.entityType,
              entityId: parsed.entityId,
              likeCount: 0,
            },
          },
          { upsert: true },
        );
        await this.redis.del(key);
        flushed += 1;
      } catch (error) {
        this.logger.error(
          `Failed to flush ${key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return flushed;
  }

  private async adjustLikeCount(
    entityType: EngagementEntityType,
    entityId: Types.ObjectId,
    delta: number,
  ): Promise<void> {
    await this.statsModel.updateOne(
      { entityType, entityId },
      {
        $inc: { likeCount: delta },
        $setOnInsert: {
          entityType,
          entityId,
          impressions: 0,
          views: 0,
          watchMs: 0,
        },
      },
      { upsert: true },
    );
    if (delta < 0) {
      await this.statsModel.updateOne(
        { entityType, entityId, likeCount: { $lt: 0 } },
        { $set: { likeCount: 0 } },
      );
    }
  }
}

function toInt(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function parseStatsKey(
  key: string,
): { entityType: EngagementEntityType; entityId: Types.ObjectId } | null {
  const parts = key.split(':');
  if (parts.length < 3 || parts[0] !== 'stats') return null;
  const entityType = parts[1] as EngagementEntityType;
  const entityId = parts.slice(2).join(':');
  if (!Types.ObjectId.isValid(entityId)) return null;
  return { entityType, entityId: new Types.ObjectId(entityId) };
}
