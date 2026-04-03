import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { date, nearbyLocationQuerySchema } from '../../core/dto';

const visibilitySchema = z.enum(['public', 'private']);
const joinModeSchema = z.enum(['open', 'approval']);
const localMatchStatusSchema = z.enum([
  'open',
  'full',
  'cancelled',
  'completed',
]);

/** GeoJSON Point: coordinates are [longitude, latitude]. */
const geoPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([
    z.number().gte(-180).lte(180),
    z.number().gte(-90).lte(90),
  ]),
});

const localMatchLocationInputSchema = z.object({
  address: z.string().trim().min(1),
  coordinates: geoPointSchema,
});

const updateLocationSchema = z
  .object({
    address: z.string().trim().min(1).optional(),
    coordinates: geoPointSchema.optional(),
  })
  .refine((d) => d.address !== undefined || d.coordinates !== undefined, {
    message: 'Provide address and/or coordinates',
  });

/** Shared identity + capacity fields for create/update. */
const localMatchBaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  sportTypes: z.array(z.string().trim().min(1)).max(20).optional(),
  maxMembers: z.number().int().min(2).max(500),
  maxPendingJoinRequests: z.number().int().min(0).max(1000),
});

const localMatchScheduleSchema = z.object({
  closingTime: date,
  eventStartsAt: date.optional(),
  eventEndsAt: date.optional(),
});

const privateCannotUseOpenJoin = (d: {
  visibility?: 'public' | 'private';
  joinMode?: 'open' | 'approval';
}) => !(d.visibility === 'private' && d.joinMode === 'open');

const createBodyShape = localMatchBaseSchema.extend(localMatchScheduleSchema.shape).extend({
  visibility: visibilitySchema,
  joinMode: joinModeSchema,
  location: localMatchLocationInputSchema.optional(),
  turf: z.string().trim().min(1).optional(),
});

const CreateLocalMatchSchema = createBodyShape
  .refine(privateCannotUseOpenJoin, {
    message: 'Private matches cannot use open join mode',
    path: ['joinMode'],
  })
  .refine((d) => d.location !== undefined || d.turf !== undefined, {
    message: 'Provide location or turf',
    path: ['location'],
  });

const UpdateLocalMatchSchema = localMatchBaseSchema
  .partial()
  .extend(
    z.object({
      closingTime: date.optional(),
      eventStartsAt: date.optional(),
      eventEndsAt: date.optional(),
    }).shape,
  )
  .extend(
    z.object({
      visibility: visibilitySchema.optional(),
      joinMode: joinModeSchema.optional(),
    }).shape,
  )
  .extend({
    location: updateLocationSchema.optional(),
    turf: z.string().trim().min(1).optional(),
    status: localMatchStatusSchema.optional(),
  })
  .refine(privateCannotUseOpenJoin, {
    message: 'Private matches cannot use open join mode',
    path: ['joinMode'],
  });

const LocalMatchFilterSchema = z
  .object({
    visibility: visibilitySchema.optional(),
    status: localMatchStatusSchema.optional(),
    sportTypes: z
      .string()
      .optional()
      .transform((s) => (s ? s.split(',').map((x) => x.trim()) : undefined)),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(50).default(10),
  })
  .extend(nearbyLocationQuerySchema.shape);

const PromoteHostSchema = z.object({
  userId: z.string().min(1),
});

const CreateLocalMatchDtoBase: ZodDto<typeof CreateLocalMatchSchema> =
  createZodDto(CreateLocalMatchSchema);
const UpdateLocalMatchDtoBase: ZodDto<typeof UpdateLocalMatchSchema> =
  createZodDto(UpdateLocalMatchSchema);
const LocalMatchFilterDtoBase: ZodDto<typeof LocalMatchFilterSchema> =
  createZodDto(LocalMatchFilterSchema);
const PromoteHostDtoBase: ZodDto<typeof PromoteHostSchema> =
  createZodDto(PromoteHostSchema);

export class CreateLocalMatchDto extends CreateLocalMatchDtoBase {}
export class UpdateLocalMatchDto extends UpdateLocalMatchDtoBase {}
export class LocalMatchFilterDto extends LocalMatchFilterDtoBase {}
export class PromoteHostDto extends PromoteHostDtoBase {}
