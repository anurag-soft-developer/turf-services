import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { config } from '../core/config/env.config';
import { MediaUploadPurpose } from '../post/dto/media-upload.dto';
import { StorageService } from './storage.service';
import {
  UnusedUploadRegistry,
  UnusedUploadRegistryDocument,
  UnusedUploadStatus,
} from './schemas/unused-upload-registry.schema';
import { StorageReferenceCollectorService } from './storage-reference-collector.service';
import { inferObjectKeyFromPublicUrl } from './storage-url.util';

const ORPHAN_LIST_CAP = 500;

export interface SyncUrlArrayParams {
  userId: string;
  entityType: string;
  entityId: string;
  previousUrls: string[];
  nextUrls: string[];
}

export interface ReconcileStorageResult {
  dryRun: boolean;
  totalObjects: number;
  referencedCount: number;
  orphanCount: number;
  orphans: { objectKey: string; sizeBytes?: number }[];
  truncated?: boolean;
  deleted?: string[];
  failed?: { objectKey: string; code?: string; message?: string }[];
}

@Injectable()
export class StorageLifecycleService {
  private readonly logger = new Logger(StorageLifecycleService.name);

  constructor(
    @InjectModel(UnusedUploadRegistry.name)
    private readonly registryModel: Model<UnusedUploadRegistryDocument>,
    private readonly storageService: StorageService,
    private readonly referenceCollector: StorageReferenceCollectorService,
  ) {}

  inferObjectKeyFromPublicUrl(url: string): string | null {
    return inferObjectKeyFromPublicUrl(url);
  }

  async registerPendingUpload(params: {
    userId: string;
    objectKey: string;
    fileUrl: string;
    purpose: MediaUploadPurpose;
  }): Promise<void> {
    const ttlHours = Number(config.UNUSED_UPLOAD_REGISTRY_TTL_HOURS) || 48;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.registryModel.findOneAndUpdate(
      { objectKey: params.objectKey },
      {
        $setOnInsert: {
          objectKey: params.objectKey,
          fileUrl: params.fileUrl,
          uploadedBy: new Types.ObjectId(params.userId),
          purpose: params.purpose,
          status: UnusedUploadStatus.PENDING,
          expiresAt,
        },
      },
      { upsert: true },
    );
  }

  async syncUrlArrayOnEntitySave(params: SyncUrlArrayParams): Promise<void> {
    const previousSet = new Set(
      params.previousUrls.filter((url) => url?.trim()),
    );
    const nextSet = new Set(params.nextUrls.filter((url) => url?.trim()));

    const added = params.nextUrls.filter(
      (url) => url?.trim() && !previousSet.has(url),
    );
    const removed = params.previousUrls.filter(
      (url) => url?.trim() && !nextSet.has(url),
    );

    for (const url of added) {
      const objectKey = this.inferObjectKeyFromPublicUrl(url);
      if (!objectKey) continue;

      await this.registryModel.findOneAndUpdate(
        { objectKey },
        {
          $set: {
            status: UnusedUploadStatus.ATTACHED,
            entityType: params.entityType,
            entityId: params.entityId,
            fileUrl: url,
            uploadedBy: new Types.ObjectId(params.userId),
          },
        },
        { upsert: true },
      );
    }

    if (removed.length > 0) {
      await this.deleteUrlsForUser(params.userId, removed);
    }
  }

  async deleteUrlsForUser(userId: string, urls: string[]): Promise<void> {
    const prefix = `users/${userId}/`;
    const keys = [
      ...new Set(
        urls
          .map((url) => this.inferObjectKeyFromPublicUrl(url))
          .filter(
            (key): key is string => key !== null && key.startsWith(prefix),
          ),
      ),
    ];

    if (keys.length === 0) {
      return;
    }

    try {
      const result = await this.storageService.deleteObjects({
        userId,
        objectKeys: keys,
      });
      if (result.failed.length > 0) {
        this.logger.warn(
          `Failed to delete ${result.failed.length} object(s) for user ${userId}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Storage delete failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.registryModel.deleteMany({ objectKey: { $in: keys } });
  }

  async purgeExpiredPendingUploads(): Promise<number> {
    const expired = await this.registryModel
      .find({
        status: UnusedUploadStatus.PENDING,
        expiresAt: { $lt: new Date() },
      })
      .lean();

    if (expired.length === 0) {
      return 0;
    }

    const keysByUser = new Map<string, string[]>();
    for (const row of expired) {
      const userId = row.uploadedBy.toString();
      const list = keysByUser.get(userId) ?? [];
      list.push(row.objectKey);
      keysByUser.set(userId, list);
    }

    for (const [userId, keys] of keysByUser) {
      try {
        await this.storageService.deleteObjects({ userId, objectKeys: keys });
      } catch (error) {
        this.logger.warn(
          `Expired upload purge failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const objectKeys = expired.map((row) => row.objectKey);
    await this.registryModel.deleteMany({ objectKey: { $in: objectKeys } });

    this.logger.log(`Purged ${expired.length} expired pending upload(s)`);
    return expired.length;
  }

  async reconcileStorage(params: {
    dryRun?: boolean;
    adminUserId?: string;
  }): Promise<ReconcileStorageResult> {
    const dryRun = params.dryRun !== false;

    const [referencedKeys, s3Objects] = await Promise.all([
      this.referenceCollector.collectAllReferencedObjectKeys(),
      this.storageService.listObjectKeys('users/'),
    ]);

    const orphans = s3Objects.filter((obj) => !referencedKeys.has(obj.key));
    const truncated = orphans.length > ORPHAN_LIST_CAP;
    const orphanSample = orphans.slice(0, ORPHAN_LIST_CAP);

    const result: ReconcileStorageResult = {
      dryRun,
      totalObjects: s3Objects.length,
      referencedCount: referencedKeys.size,
      orphanCount: orphans.length,
      orphans: orphanSample.map((obj) => ({
        objectKey: obj.key,
        sizeBytes: obj.sizeBytes,
      })),
      ...(truncated ? { truncated: true } : {}),
    };

    this.logger.log(
      `Storage reconcile (dryRun=${dryRun}, admin=${params.adminUserId ?? 'unknown'}): ` +
        `${orphans.length} orphan(s) of ${s3Objects.length} total, ${referencedKeys.size} referenced`,
    );

    if (dryRun) {
      return result;
    }

    if (config.STORAGE_RECONCILE_ENABLED !== 'true') {
      this.logger.warn(
        'Storage reconcile execute blocked: STORAGE_RECONCILE_ENABLED is not true',
      );
      return result;
    }

    const orphanKeys = orphans.map((obj) => obj.key);
    if (orphanKeys.length === 0) {
      return result;
    }

    const deleteResult =
      await this.storageService.deleteObjectsAdmin(orphanKeys);
    await this.registryModel.deleteMany({ objectKey: { $in: orphanKeys } });

    return {
      ...result,
      deleted: deleteResult.deleted,
      failed: deleteResult.failed,
    };
  }
}
