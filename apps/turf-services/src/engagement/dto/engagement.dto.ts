import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ENGAGEMENT_ENTITY_TYPES,
  ENGAGEMENT_EVENT_KINDS,
} from '../engagement.constants';

const entityRefSchema = z.object({
  entityType: z.enum(ENGAGEMENT_ENTITY_TYPES),
  entityId: z.string().trim().min(1),
});

const EngagementBatchEventSchema = entityRefSchema.extend({
  kind: z.enum(ENGAGEMENT_EVENT_KINDS),
  watchMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
});

const EngagementBatchSchema = z.object({
  events: z.array(EngagementBatchEventSchema).min(1).max(50),
});

const LikeBodySchema = entityRefSchema;

export class EngagementBatchDto extends createZodDto(EngagementBatchSchema) {}
export class LikeBodyDto extends createZodDto(LikeBodySchema) {}
