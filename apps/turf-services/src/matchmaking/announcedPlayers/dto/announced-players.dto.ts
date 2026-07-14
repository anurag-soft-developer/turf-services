import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const objectId = z.string().min(1);

const announcedPlayerRoleSchema = z.enum([
  'batsman',
  'bowler',
  'allrounder',
  'wicket_keeper',
]);

const AnnouncedPlayerCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  avatar: z.string().trim().max(2000).optional(),
  email: z.string().trim().email().max(320).optional(),
  userId: objectId,
  is_substitute: z.boolean().optional().default(false),
  role: announcedPlayerRoleSchema,
  isCaption: z.boolean().optional().default(false),
  isWiseCaption: z.boolean().optional().default(false),
});

const AddAnnouncedPlayersSchema = z.object({
  actorTeamId: objectId,
  players: z.array(AnnouncedPlayerCreateSchema).min(1).max(50),
});

const RemoveAnnouncedPlayersSchema = z.object({
  actorTeamId: objectId,
  userIds: z.array(objectId).min(1), //.max(50),
});

const AnnouncedPlayerUpdateRowSchema = z
  .object({
    userId: objectId,
    name: z.string().trim().min(1).max(200).optional(),
    avatar: z.string().trim().max(2000).optional(),
    email: z.string().trim().email().max(320).optional(),
    is_substitute: z.boolean().optional(),
    role: announcedPlayerRoleSchema.optional(),
    isCaption: z.boolean().optional(),
    isWiseCaption: z.boolean().optional(),
  })
  .refine(
    (row) =>
      row.name !== undefined ||
      row.avatar !== undefined ||
      row.email !== undefined ||
      row.is_substitute !== undefined ||
      row.role !== undefined ||
      row.isCaption !== undefined ||
      row.isWiseCaption !== undefined,
    {
      message:
        'Each update entry must set at least one field to change besides userId',
    },
  );

const UpdateAnnouncedPlayersSchema = z.object({
  actorTeamId: objectId,
  updates: z.array(AnnouncedPlayerUpdateRowSchema).min(1).max(50),
});

export class AddAnnouncedPlayersDto extends createZodDto(
  AddAnnouncedPlayersSchema,
) {}
export class RemoveAnnouncedPlayersDto extends createZodDto(
  RemoveAnnouncedPlayersSchema,
) {}
export class UpdateAnnouncedPlayersDto extends createZodDto(
  UpdateAnnouncedPlayersSchema,
) {}
