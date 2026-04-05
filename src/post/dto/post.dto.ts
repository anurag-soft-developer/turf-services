import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { geoLocationSchema } from '../../core/dto';

const postStatusSchema = z.enum(['draft', 'published', 'archived']);
const mediaKindSchema = z.enum(['image', 'video']);

const mediaInputSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  kind: mediaKindSchema,
  caption: z.string().trim().max(500).optional(),
});

const CreatePostSchema = z
  .object({
    title: z.string().trim().max(300).default(''),
    content: z.string().trim().max(20000).default(''),
    tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
    status: postStatusSchema.optional(),
    team: z.string().trim().min(1).optional(),
    location: geoLocationSchema.optional(),
    media: z.array(mediaInputSchema).max(30).optional(),
  })
  .refine(
    (d) =>
      (d.title && d.title.length > 0) ||
      (d.content && d.content.length > 0) ||
      (d.media && d.media.length > 0),
    {
      message: 'Provide at least a non-empty title, content, or media',
    },
  );

const UpdatePostSchema = z
  .object({
    title: z.string().trim().max(300).optional(),
    content: z.string().trim().max(20000).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
    status: postStatusSchema.optional(),
    team: z.string().trim().min(1).nullable().optional(),
    location: geoLocationSchema.nullable().optional(),
    media: z.array(mediaInputSchema).max(30).optional(),
    mediaIds: z.array(z.string().trim().min(1)).max(30).optional(),
  })
  .refine(
    (d) =>
      d.title !== undefined ||
      d.content !== undefined ||
      d.tags !== undefined ||
      d.status !== undefined ||
      d.team !== undefined ||
      d.location !== undefined ||
      d.media !== undefined ||
      d.mediaIds !== undefined,
    { message: 'Provide at least one field to update' },
  )
  .refine((d) => !(d.media !== undefined && d.mediaIds !== undefined), {
    message: 'Provide either media or mediaIds, not both',
    path: ['mediaIds'],
  });

const PostFilterSchema = z.object({
  team: z.string().trim().min(1).optional(),
  postedBy: z.string().trim().min(1).optional(),
  status: postStatusSchema.optional(),
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(10),
});

const CreateMediaSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  kind: mediaKindSchema,
  caption: z.string().trim().max(500).optional(),
});

const CreatePostDtoBase: ZodDto<typeof CreatePostSchema> =
  createZodDto(CreatePostSchema);
const UpdatePostDtoBase: ZodDto<typeof UpdatePostSchema> =
  createZodDto(UpdatePostSchema);
const PostFilterDtoBase: ZodDto<typeof PostFilterSchema> =
  createZodDto(PostFilterSchema);
const CreateMediaDtoBase: ZodDto<typeof CreateMediaSchema> =
  createZodDto(CreateMediaSchema);

export class CreatePostDto extends CreatePostDtoBase {}
export class UpdatePostDto extends UpdatePostDtoBase {}
export class PostFilterDto extends PostFilterDtoBase {}
export class CreateMediaDto extends CreateMediaDtoBase {}
