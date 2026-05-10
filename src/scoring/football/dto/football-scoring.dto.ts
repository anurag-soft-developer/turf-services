import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const objectId = z.string().min(1);

const footballPeriodSchema = z.enum([
  'first_half',
  'second_half',
  'extra_first',
  'extra_second',
  'penalties',
]);

const footballEventPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('goal'),
    beneficiaryTeamId: objectId,
    scorerUserId: objectId,
    assistUserId: objectId.optional(),
  }),
  z.object({
    kind: z.literal('own_goal'),
    beneficiaryTeamId: objectId,
    concedingPlayerUserId: objectId,
  }),
  z.object({
    kind: z.literal('yellow_card'),
    teamId: objectId,
    playerUserId: objectId,
  }),
  z.object({
    kind: z.literal('red_card'),
    teamId: objectId,
    playerUserId: objectId,
  }),
  z.object({
    kind: z.literal('substitution'),
    teamId: objectId,
    playerOffUserId: objectId,
    playerOnUserId: objectId,
  }),
  z.object({
    kind: z.literal('penalty_scored'),
    beneficiaryTeamId: objectId,
    takerUserId: objectId,
  }),
  z.object({
    kind: z.literal('penalty_missed'),
    teamId: objectId,
    takerUserId: objectId,
  }),
]);

const CreateFootballSessionSchema = z.object({
  actorTeamId: objectId,
  period: footballPeriodSchema.default('first_half'),
  matchMinute: z.coerce.number().int().min(0).max(130).optional(),
});

const AppendFootballEventSchema = z.object({
  period: footballPeriodSchema,
  matchMinute: z.coerce.number().int().min(0).max(130).optional(),
  payload: footballEventPayloadSchema,
});

const ListFootballEventsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export class CreateFootballSessionDto extends createZodDto(
  CreateFootballSessionSchema,
) {}
export class AppendFootballEventDto extends createZodDto(
  AppendFootballEventSchema,
) {}
export class ListFootballEventsDto extends createZodDto(
  ListFootballEventsSchema,
) {}
