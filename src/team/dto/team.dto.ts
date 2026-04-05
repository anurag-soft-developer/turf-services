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

const teamBaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  sportType: sportTypeSchema,
  maxRosterSize: z.number().int().min(2).max(500),
  maxPendingJoinRequests: z.number().int().min(0).max(1000),
  logo: z.string().trim().max(2048).optional(),
  coverImages: z
    .array(z.string().trim().min(1).max(2048))
    .max(20)
    .optional(),
});

const privateCannotUseOpenJoin = (d: {
  visibility?: 'public' | 'private';
  joinMode?: 'open' | 'approval';
}) => !(d.visibility === 'private' && d.joinMode === 'open');

const createBodyShape = teamBaseSchema.extend({
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
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(10),
  location: nearbyLocationQuerySchema.optional(),
});

const PromoteOwnerSchema = z.object({
  userId: z.string().min(1),
});

const CreateTeamDtoBase: ZodDto<typeof CreateTeamSchema> =
  createZodDto(CreateTeamSchema);
const UpdateTeamDtoBase: ZodDto<typeof UpdateTeamSchema> =
  createZodDto(UpdateTeamSchema);
const TeamFilterDtoBase: ZodDto<typeof TeamFilterSchema> =
  createZodDto(TeamFilterSchema);
const PromoteOwnerDtoBase: ZodDto<typeof PromoteOwnerSchema> =
  createZodDto(PromoteOwnerSchema);

export class CreateTeamDto extends CreateTeamDtoBase {}
export class UpdateTeamDto extends UpdateTeamDtoBase {}
export class TeamFilterDto extends TeamFilterDtoBase {}
export class PromoteOwnerDto extends PromoteOwnerDtoBase {}
