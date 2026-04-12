import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const teamMemberStatusSchema = z.enum([
  'pending',
  'active',
  'resigned',
  'removed',
  'rejected',
  'suspended',
]);

const leadershipRoleSchema = z.enum(['captain', 'vice_captain']);
const lineupCategorySchema = z.enum(['starter', 'substitute']);

const UpdateTeamMemberSchema = z
  .object({
    leadershipRole: leadershipRoleSchema.nullable().optional(),
    playingPosition: z.string().trim().max(80).nullable().optional(),
    lineupCategory: lineupCategorySchema.optional(),
    jerseyNumber: z.number().int().min(1).max(99).nullable().optional(),
    nickname: z.string().trim().max(50).nullable().optional(),
    isVerified: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Provide at least one field to update',
  });

const SuspendTeamMemberSchema = z.object({
  /** ISO date string; omit for an indefinite suspension. */
  suspendedUntil: z.coerce.date().optional(),
});

const TeamMemberFilterSchema = z.object({
  status: teamMemberStatusSchema.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const MyMembershipsFilterSchema = z.object({
  status: teamMemberStatusSchema.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export class UpdateTeamMemberDto extends createZodDto(UpdateTeamMemberSchema) {}
export class SuspendTeamMemberDto extends createZodDto(
  SuspendTeamMemberSchema,
) {}
export class TeamMemberFilterDto extends createZodDto(TeamMemberFilterSchema) {}
export class MyMembershipsFilterDto extends createZodDto(
  MyMembershipsFilterSchema,
) {}
