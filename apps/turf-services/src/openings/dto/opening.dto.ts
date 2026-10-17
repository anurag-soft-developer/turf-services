import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { sportTypeSchema } from '../../core/sports/sport-types';

const openingTypeSchema = z.enum(['team', 'tournament']);
const openingStatusSchema = z.enum(['open', 'onHold', 'closed']);

const CreateOpeningSchema = z
  .object({
    type: openingTypeSchema,
    teamId: z.string().trim().min(1).optional(),
    tournamentId: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    maxPendingJoinRequests: z.number().int().min(0).max(1000).default(50),
  })
  .superRefine(requireHostId);

const OpeningTargetQuerySchema = z
  .object({
    type: openingTypeSchema,
    teamId: z.string().trim().min(1).optional(),
    tournamentId: z.string().trim().min(1).optional(),
  })
  .superRefine(requireHostId);

function requireHostId(
  value: { type: 'team' | 'tournament'; teamId?: string; tournamentId?: string },
  ctx: z.RefinementCtx,
) {
  if (value.type === 'team' && !value.teamId) {
    ctx.addIssue({
      code: 'custom',
      path: ['teamId'],
      message: 'A team opening needs a team',
    });
  }
  if (value.type === 'tournament' && !value.tournamentId) {
    ctx.addIssue({
      code: 'custom',
      path: ['tournamentId'],
      message: 'A tournament opening needs a tournament',
    });
  }
}

const UpdateOpeningSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    status: openingStatusSchema.optional(),
    maxPendingJoinRequests: z.number().int().min(0).max(1000).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.status !== undefined ||
      value.maxPendingJoinRequests !== undefined,
    { message: 'Provide a title, status, or pending limit' },
  );

const OpeningFilterSchema = z.object({
  type: openingTypeSchema.optional(),
  sportType: sportTypeSchema.optional(),
  status: openingStatusSchema.default('open'),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export class CreateOpeningDto extends createZodDto(CreateOpeningSchema) {}
export class UpdateOpeningDto extends createZodDto(UpdateOpeningSchema) {}
export class OpeningFilterDto extends createZodDto(OpeningFilterSchema) {}
export class OpeningTargetQueryDto extends createZodDto(
  OpeningTargetQuerySchema,
) {}
