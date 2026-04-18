import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

export enum MediaUploadPurpose {
  POST_MEDIA = 'postMedia',
  AVATAR = 'avatar',
  TURF_MEDIA = 'turfMedia',
  TEAM_MEDIA = 'teamMedia',
}

export const mediaUploadPurposeSchema = z.enum(MediaUploadPurpose);

export const UploadUrlRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(128),
  sizeBytes: z.coerce.number().int().positive(),
  purpose: mediaUploadPurposeSchema,
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

export const DirectUploadBodySchema = z.object({
  purpose: mediaUploadPurposeSchema,
});


export class UploadUrlRequestDto extends  createZodDto(UploadUrlRequestSchema) {}
export class DirectUploadBodyDto extends  createZodDto(DirectUploadBodySchema) {}
