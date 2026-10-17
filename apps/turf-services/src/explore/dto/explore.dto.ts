import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { nearbyLocationQuerySchema } from '../../core/dto';
import { sportTypeSchema } from '../../core/sports/sport-types';

const ExploreQuerySchema = z.object({
  /** Absent = feed mode; present = search mode. */
  q: z.string().trim().min(1).max(80).optional(),
  category: z
    .enum(['all', 'match', 'team', 'player', 'post'])
    .default('all'),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  sportType: sportTypeSchema.optional(),
  location: nearbyLocationQuerySchema.optional(),
  matchScope: z.enum(['mine', 'all']).default('all'),
  matchStatus: z
    .enum(['all', 'live', 'upcoming', 'completed'])
    .default('all'),
  /** Posts category only. `all` mixes media posts and openings. */
  postKind: z.enum(['all', 'media', 'opening']).default('all'),
});

export class ExploreQueryDto extends createZodDto(ExploreQuerySchema) {}
