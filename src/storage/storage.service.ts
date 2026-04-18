import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { config } from '../core/config/env.config';
import { MediaUploadPurpose } from '../post/dto/media-upload.dto';


interface SignUploadParams {
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: MediaUploadPurpose;
  idempotencyKey?: string;
}

interface DirectUploadParams {
  userId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  purpose: MediaUploadPurpose;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const DEFAULT_SIGNED_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const DELETE_OBJECTS_BATCH_SIZE = 1000;

/** Readable anonymously via URL after upload (Spaces/S3 canned ACL). */
const OBJECT_ACL_PUBLIC_READ = 'public-read' as const;

@Injectable()
export class StorageService {
  private readonly s3 = new S3Client({
    region: config.SPACES_REGION,
    endpoint: config.SPACES_ENDPOINT,
    credentials: {
      accessKeyId: config.SPACES_ACCESS_KEY_ID,
      secretAccessKey: config.SPACES_SECRET_ACCESS_KEY,
    },
  });

  async createSignedUploadUrl(params: SignUploadParams): Promise<{
    uploadUrl: string;
    fileUrl: string;
    objectKey: string;
    expiresAt: string;
    headers: { 'Content-Type': string; 'x-amz-acl': typeof OBJECT_ACL_PUBLIC_READ };
  }> {
    this.assertAllowedMimeType(params.mimeType);
    this.assertPositiveSize(params.sizeBytes);
    this.assertMaxSize(params.sizeBytes, DEFAULT_SIGNED_UPLOAD_MAX_BYTES);

    const objectKey = this.createObjectKey(
      params.userId,
      params.purpose,
      params.fileName,
      params.idempotencyKey,
    );

    const command = new PutObjectCommand({
      Bucket: config.SPACES_BUCKET,
      Key: objectKey,
      ContentType: params.mimeType,
      ACL: OBJECT_ACL_PUBLIC_READ,
    });

    const ttlSeconds = Number(config.SPACES_SIGNED_URL_TTL_SECONDS);
    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: ttlSeconds,
    });

    return {
      uploadUrl,
      fileUrl: this.getPublicUrl(objectKey),
      objectKey,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      headers: {
        'Content-Type': params.mimeType,
        'x-amz-acl': OBJECT_ACL_PUBLIC_READ,
      },
    };
  }

  async uploadBuffer(params: DirectUploadParams): Promise<{
    fileUrl: string;
    objectKey: string;
  }> {
    this.assertAllowedMimeType(params.mimeType);
    this.assertPositiveSize(params.buffer.byteLength);
    this.assertMaxSize(params.buffer.byteLength, 5 * 1024 * 1024);

    const objectKey = this.createObjectKey(
      params.userId,
      params.purpose,
      params.fileName,
    );

    await this.s3.send(
      new PutObjectCommand({
        Bucket: config.SPACES_BUCKET,
        Key: objectKey,
        Body: params.buffer,
        ContentType: params.mimeType,
        ACL: OBJECT_ACL_PUBLIC_READ,
      }),
    );

    return {
      fileUrl: this.getPublicUrl(objectKey),
      objectKey,
    };
  }

  async deleteObjects(params: {
    userId: string;
    objectKeys: string[];
  }): Promise<{
    deleted: string[];
    failed: { objectKey: string; code?: string; message?: string }[];
  }> {
    const normalized = [...new Set(params.objectKeys.map((k) => k.replace(/^\/+/, '')))];
    const prefix = `users/${params.userId}/`;
    for (const key of normalized) {
      if (key.includes('..')) {
        throw new BadRequestException('Invalid object key');
      }
      if (!key.startsWith(prefix)) {
        throw new ForbiddenException('Cannot delete objects outside your storage prefix');
      }
    }

    const deleted: string[] = [];
    const failed: { objectKey: string; code?: string; message?: string }[] = [];

    for (let i = 0; i < normalized.length; i += DELETE_OBJECTS_BATCH_SIZE) {
      const batch = normalized.slice(i, i + DELETE_OBJECTS_BATCH_SIZE);
      const result = await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: config.SPACES_BUCKET,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: false,
          },
        }),
      );
      for (const d of result.Deleted ?? []) {
        if (d.Key) {
          deleted.push(d.Key);
        }
      }
      for (const err of result.Errors ?? []) {
        if (err.Key) {
          failed.push({
            objectKey: err.Key,
            code: err.Code,
            message: err.Message,
          });
        }
      }
    }

    return { deleted, failed };
  }

  private createObjectKey(
    userId: string,
    purpose: MediaUploadPurpose,
    fileName: string,
    providedIdempotencyKey?: string,
  ): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const safeFileName = this.sanitizeFileName(fileName);
    const suffix = this.sanitizeToken(providedIdempotencyKey) ?? randomUUID();
    return `users/${userId}/${purpose}/${yyyy}/${mm}/${suffix}-${safeFileName}`;
  }

  private sanitizeFileName(fileName: string): string {
    const trimmed = fileName.trim().toLowerCase();
    const safe = trimmed.replace(/[^a-z0-9._-]/g, '-');
    const collapsed = safe.replace(/-+/g, '-').replace(/^\.+/, '');
    return collapsed || `upload-${Date.now()}`;
  }

  private sanitizeToken(token?: string): string | null {
    if (!token?.trim()) {
      return null;
    }
    const safe = token.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return safe || null;
  }

  private getPublicUrl(objectKey: string): string {
    const cdnBase = config.SPACES_CDN_BASE_URL?.trim();
    if (cdnBase) {
      return `${cdnBase.replace(/\/+$/, '')}/${objectKey}`;
    }

    const endpointHost = config.SPACES_ENDPOINT
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    return `https://${config.SPACES_BUCKET}.${endpointHost}/${objectKey}`;
  }

  private assertAllowedMimeType(mimeType: string): void {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException('Unsupported file type');
    }
  }

  private assertPositiveSize(sizeBytes: number): void {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new BadRequestException('Invalid file size');
    }
  }

  private assertMaxSize(sizeBytes: number, maxBytes: number): void {
    if (sizeBytes > maxBytes) {
      throw new BadRequestException(`File size exceeds ${maxBytes} bytes`);
    }
  }
}
