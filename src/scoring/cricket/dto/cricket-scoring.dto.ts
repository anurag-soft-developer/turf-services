import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const objectId = z.string().min(1);

const cricketOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dot') }),
  z.object({
    kind: z.literal('runs'),
    offBat: z.coerce.number().int().min(1).max(6),
  }),
  z.object({
    kind: z.literal('wide'),
    additionalRuns: z.coerce.number().int().min(0).max(5).default(0),
  }),
  z.object({
    kind: z.literal('no_ball'),
    offBat: z.coerce.number().int().min(0).max(6).default(0),
  }),
  z.object({
    kind: z.literal('bye'),
    runs: z.coerce.number().int().min(1).max(6),
  }),
  z.object({
    kind: z.literal('leg_bye'),
    runs: z.coerce.number().int().min(1).max(6),
  }),
  z.object({
    kind: z.literal('wicket_bowled'),
    offBat: z.coerce.number().int().min(0).max(6).default(0),
  }),
  z.object({
    kind: z.literal('wicket_caught'),
    offBat: z.coerce.number().int().min(0).max(6).default(0),
    fielderUserId: objectId,
  }),
  z.object({
    kind: z.literal('wicket_lbw'),
    offBat: z.coerce.number().int().min(0).max(6).default(0),
  }),
  z.object({
    kind: z.literal('wicket_run_out'),
    runsOffBat: z.coerce.number().int().min(0).max(6).default(0),
    dismissedUserId: objectId,
    fielderUserId: objectId.optional(),
  }),
  z.object({
    kind: z.literal('wicket_stumped'),
    offBat: z.coerce.number().int().min(0).max(6).default(0),
    wicketKeeperUserId: objectId,
  }),
  z.object({
    kind: z.literal('wicket_hit_wicket'),
    offBat: z.coerce.number().int().min(0).max(6).default(0),
  }),
]);

const CreateCricketSessionSchema = z.object({
  actorTeamId: objectId,
  battingTeamId: objectId,
  bowlingTeamId: objectId,
  maxOvers: z.coerce.number().int().min(1).max(120).default(20),
  strikerUserId: objectId.optional(),
  nonStrikerUserId: objectId.optional(),
  bowlerUserId: objectId.optional(),
});

const AppendCricketBallSchema = z.object({
  strikerUserId: objectId,
  nonStrikerUserId: objectId,
  bowlerUserId: objectId,
  outcome: cricketOutcomeSchema,
  /** Required when a wicket falls: the new batter taking the vacated crease. */
  incomingBatsmanUserId: objectId.optional(),
});

export class CreateCricketSessionDto extends createZodDto(
  CreateCricketSessionSchema,
) {}
export class AppendCricketBallDto extends createZodDto(
  AppendCricketBallSchema,
) {}

const UpdateCricketStateSchema = z
  .object({
    actorTeamId: objectId,
    strikerUserId: objectId.optional(),
    nonStrikerUserId: objectId.optional(),
    bowlerUserId: objectId.optional(),
  })
  .refine(
    (v) =>
      v.strikerUserId !== undefined ||
      v.nonStrikerUserId !== undefined ||
      v.bowlerUserId !== undefined,
    { message: 'Provide at least one of strikerUserId, nonStrikerUserId, bowlerUserId' },
  );

export class UpdateCricketStateDto extends createZodDto(
  UpdateCricketStateSchema,
) {}
