import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { rankingSportTypeSchema } from '../../core/sports/sport-types';

const leaderboardQuerySchema = z.object({
  sportType: rankingSportTypeSchema.default('cricket'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export class LeaderboardQueryDto extends createZodDto(leaderboardQuerySchema) {}
