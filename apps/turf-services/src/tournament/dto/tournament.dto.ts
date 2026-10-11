import { createZodDto } from 'nestjs-zod';
import { Types } from 'mongoose';
import { z } from 'zod';
import { scoringSportTypeSchema } from '../../core/sports/sport-types';
import {
  TOURNAMENT_MIN_LEAGUE_TEAMS,
  TournamentFormat,
  TournamentStatus,
  tournamentSizeError,
} from '../tournament.constants';
const objectId = z
  .string()
  .trim()
  .refine((value) => Types.ObjectId.isValid(value), 'Invalid id');

const formatSchema = z.enum(TournamentFormat);
const statusSchema = z.enum(TournamentStatus);

function commaSeparatedQueryToStrings(val: unknown): string[] | undefined {
  if (val == null || val === '') return undefined;
  if (Array.isArray(val)) {
    return val
      .flatMap((x) =>
        typeof x === 'string' ? x.split(',').map((s) => s.trim()) : [],
      )
      .filter(Boolean);
  }
  if (typeof val === 'string') {
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

/** Query `status=ongoing` or `status=inviting,scheduled` or repeated `status=`. */
const parseTournamentStatusQuery = z.preprocess(
  commaSeparatedQueryToStrings,
  z.array(statusSchema).max(10).optional(),
);

const coverImagesSchema = z
  .array(z.string().trim().min(1).max(2048))
  .max(5)
  .optional();

const optionalDateSchema = z.coerce.date().optional();

function assertTournamentDates(data: {
  startDate?: Date;
  endDate?: Date;
  registrationDeadline?: Date;
}): void {
  if (
    data.startDate &&
    data.endDate &&
    data.endDate.getTime() < data.startDate.getTime()
  ) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: 'End date cannot be before start date',
        path: ['endDate'],
      },
    ]);
  }
  if (
    data.registrationDeadline &&
    data.startDate &&
    data.registrationDeadline.getTime() > data.startDate.getTime()
  ) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: 'Registration deadline cannot be after the start date',
        path: ['registrationDeadline'],
      },
    ]);
  }
}

const CreateTournamentSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    format: formatSchema,
    maxTeams: z.coerce
      .number()
      .int()
      .min(TOURNAMENT_MIN_LEAGUE_TEAMS)
      .optional(),
    maxOvers: z.coerce.number().int().min(1).max(120).default(20),
    coverImages: coverImagesSchema,
    asDraft: z.boolean().optional().default(false),
    sportType: scoringSportTypeSchema.optional().default('cricket'),
    description: z.string().trim().max(500).optional(),
    venueName: z.string().trim().max(120).optional(),
    startDate: optionalDateSchema,
    endDate: optionalDateSchema,
    registrationDeadline: optionalDateSchema,
    isPublic: z.boolean().optional().default(true),
  })
  .superRefine((data, ctx) => {
    try {
      assertTournamentDates(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        for (const issue of error.issues) {
          ctx.addIssue({ ...issue, code: 'custom' });
        }
      }
    }
    if (data.maxTeams != null) {
      const sizeError = tournamentSizeError(data.format, data.maxTeams);
      if (sizeError) {
        ctx.addIssue({
          code: 'custom',
          message: sizeError,
          path: ['maxTeams'],
        });
      }
    }
  });

const UpdateTournamentSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    format: formatSchema.optional(),
    maxTeams: z.coerce
      .number()
      .int()
      .min(TOURNAMENT_MIN_LEAGUE_TEAMS)
      .optional(),
    maxOvers: z.coerce.number().int().min(1).max(120).optional(),
    coverImages: coverImagesSchema,
    sportType: scoringSportTypeSchema.optional(),
    description: z.string().trim().max(500).optional(),
    venueName: z.string().trim().max(120).optional(),
    startDate: optionalDateSchema,
    endDate: optionalDateSchema,
    registrationDeadline: optionalDateSchema,
    isPublic: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    try {
      assertTournamentDates(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        for (const issue of error.issues) {
          ctx.addIssue({ ...issue, code: 'custom' });
        }
      }
    }
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one field to update',
  });

const AddOrganizerSchema = z.object({
  userId: objectId,
});

const BracketWinnerSchema = z.object({
  teamId: objectId,
});

const QualifierPickSchema = z.object({
  groupLabel: z.string().trim().min(1).max(8),
  teamIds: z.array(objectId).min(1).max(128),
});

const UpdateFixtureTeamsSchema = z
  .object({
    fromTeamId: objectId.nullable().optional(),
    toTeamId: objectId.nullable().optional(),
  })
  .refine(
    (data) => data.fromTeamId !== undefined || data.toTeamId !== undefined,
    { message: 'Provide at least one side to update' },
  );

const ListTournamentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: parseTournamentStatusQuery,
  sportType: scoringSportTypeSchema.optional(),
});

export class CreateTournamentDto extends createZodDto(CreateTournamentSchema) {}
export class UpdateTournamentDto extends createZodDto(UpdateTournamentSchema) {}
export class AddOrganizerDto extends createZodDto(AddOrganizerSchema) {}
export class BracketWinnerDto extends createZodDto(BracketWinnerSchema) {}
export class QualifierPickDto extends createZodDto(QualifierPickSchema) {}
export class UpdateFixtureTeamsDto extends createZodDto(
  UpdateFixtureTeamsSchema,
) {}
export class ListTournamentsDto extends createZodDto(ListTournamentsSchema) {}
