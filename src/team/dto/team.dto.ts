import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  geoLocationPartialSchema,
  geoLocationSchema,
  nearbyLocationQuerySchema,
} from '../../core/dto';

const visibilitySchema = z.enum(['public', 'private']);
const joinModeSchema = z.enum(['open', 'approval']);
const sportTypeSchema = z.enum(['cricket', 'football']);
const teamStatusSchema = z.enum(['active', 'inactive', 'archived']);
const genderCategorySchema = z.enum(['male', 'female', 'mixed']);
const preferredTimeSlotSchema = z.enum(['morning', 'afternoon', 'evening']);
const dayOfWeekSchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const socialLinksSchema = z
  .object({
    instagram: z.string().trim().max(100).optional(),
    twitter: z.string().trim().max(100).optional(),
    facebook: z.string().trim().max(100).optional(),
    youtube: z.string().trim().max(100).optional(),
  })
  .optional();

const teamBaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  shortName: z.string().trim().max(10).optional(),
  description: z.string().trim().max(2000).optional(),
  tagline: z.string().trim().max(160).optional(),
  socialLinks: socialLinksSchema,
  foundedYear: z.number().int().min(1800).max(2100).optional(),
  genderCategory: genderCategorySchema.optional(),
  maxPendingJoinRequests: z.number().int().min(0).max(1000),
  logo: z.string().trim().max(2048).optional(),
  coverImages: z
    .array(z.string().trim().min(1).max(2048))
    .max(20)
    .optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  preferredPlayDays: z.array(dayOfWeekSchema).max(7).optional(),
  preferredTimeSlot: preferredTimeSlotSchema.optional(),
  lookingForMembers: z.boolean().optional(),
  teamOpenForMatch: z.boolean().optional(),
  pinnedNotices: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
});

const privateCannotUseOpenJoin = (d: {
  visibility?: 'public' | 'private';
  joinMode?: 'open' | 'approval';
}) => !(d.visibility === 'private' && d.joinMode === 'open');

const createBodyShape = teamBaseSchema.extend({
  sportType: sportTypeSchema,
  visibility: visibilitySchema,
  joinMode: joinModeSchema,
  location: geoLocationSchema.optional(),
});

const CreateTeamSchema = createBodyShape.refine(privateCannotUseOpenJoin, {
  message: 'Private teams cannot use open join mode',
  path: ['joinMode'],
});

const UpdateTeamSchema = teamBaseSchema
  .partial()
  .extend(
    z.object({
      visibility: visibilitySchema.optional(),
      joinMode: joinModeSchema.optional(),
      status: teamStatusSchema.optional(),
    }).shape,
  )
  .extend({
    location: geoLocationPartialSchema.nullable().optional(),
    logo: z.string().trim().max(2048).optional(),
    coverImages: z
      .array(z.string().trim().min(1).max(2048))
      .max(20)
      .optional(),
  })
  .refine(privateCannotUseOpenJoin, {
    message: 'Private teams cannot use open join mode',
    path: ['joinMode'],
  });

const TeamFilterSchema = z.object({
  visibility: visibilitySchema.optional(),
  status: teamStatusSchema.optional(),
  sportType: sportTypeSchema.optional(),
  genderCategory: genderCategorySchema.optional(),
  lookingForMembers: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(10),
  location: nearbyLocationQuerySchema.optional(),
  teamOpenForMatch: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const PromoteOwnerSchema = z.object({
  userId: z.string().min(1),
});



export class CreateTeamDto extends createZodDto(CreateTeamSchema) {}
export class UpdateTeamDto extends createZodDto(UpdateTeamSchema) {}
export class TeamFilterDto extends  createZodDto(TeamFilterSchema) {}
export class PromoteOwnerDto extends  createZodDto(PromoteOwnerSchema) {}
