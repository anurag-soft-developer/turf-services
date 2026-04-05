import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const teamMemberStatusSchema = z.enum([
  'pending',
  'active',
  'resigned',
  'removed',
  'rejected',
]);

const leadershipRoleSchema = z.enum(['captain', 'vice_captain']);
const lineupCategorySchema = z.enum(['starter', 'substitute']);

const UpdateTeamMemberSchema = z
  .object({
    leadershipRole: leadershipRoleSchema.nullable().optional(),
    playingPosition: z.string().trim().max(80).nullable().optional(),
    lineupCategory: lineupCategorySchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Provide at least one field to update',
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

const UpdateTeamMemberDtoBase: ZodDto<typeof UpdateTeamMemberSchema> =
  createZodDto(UpdateTeamMemberSchema);
const TeamMemberFilterDtoBase: ZodDto<typeof TeamMemberFilterSchema> =
  createZodDto(TeamMemberFilterSchema);
const MyMembershipsFilterDtoBase: ZodDto<typeof MyMembershipsFilterSchema> =
  createZodDto(MyMembershipsFilterSchema);

export class UpdateTeamMemberDto extends UpdateTeamMemberDtoBase {}
export class TeamMemberFilterDto extends TeamMemberFilterDtoBase {}
export class MyMembershipsFilterDto extends MyMembershipsFilterDtoBase {}
