import z from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';

export const date = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), 'Invalid start time format');

/**
 * GeoJSON Point: coordinates are [longitude, latitude].
 * Matches `GeoPoint` / `GeoLocation.coordinates` in geo-location.schema.
 * `type` defaults to `"Point"` when omitted.
 */
export const geoPointSchema = z.object({
  type: z.literal('Point').default('Point'),
  coordinates: z.tuple([
    z.number().gte(-180).lte(180),
    z.number().gte(-90).lte(90),
  ]),
});

/** Full location body; matches `GeoLocation` in geo-location.schema. */
export const geoLocationSchema = z.object({
  address: z.string().trim().min(1),
  coordinates: geoPointSchema,
});

/** PATCH-style location: at least one of address or coordinates. */
export const geoLocationPartialSchema = z
  .object({
    address: z.string().trim().min(1).optional(),
    coordinates: geoPointSchema.optional(),
  })
  .refine((d) => d.address !== undefined || d.coordinates !== undefined, {
    message: 'Provide address and/or coordinates',
  });

/** Geo filter: query params or nested under `location` (lat/lng + radius km). */
export const nearbyLocationQuerySchema = z.object({
  nearbyLat: z.coerce.number().gte(-90).lte(90),
  nearbyLng: z.coerce.number().gte(-180).lte(180),
  nearbyRadiusKm: z.coerce
  .number()
  .min(0.1)
  .max(500)
  .default(10),
});

const LocationFilterDtoBase: ZodDto<typeof nearbyLocationQuerySchema> =
  createZodDto(nearbyLocationQuerySchema);

export class LocationFilterDto extends LocationFilterDtoBase {}
