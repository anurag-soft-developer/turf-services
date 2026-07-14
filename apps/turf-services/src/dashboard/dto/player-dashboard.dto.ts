import { z } from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';
import { nearbyLocationQuerySchema } from '../../core/dto';

/** Player dashboard query; default nearby radius is 10 km (teams-aligned). */
export const PlayerDashboardQuerySchema = z.object({
  location: nearbyLocationQuerySchema
    .extend({
      nearbyRadiusKm: z.coerce.number().min(0.1).max(500).default(10),
    })
    .optional(),
});

export class PlayerDashboardQueryDto extends createZodDto(
  PlayerDashboardQuerySchema,
) {}
