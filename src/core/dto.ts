import z from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';

export const date = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), 'Invalid start time format');


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
