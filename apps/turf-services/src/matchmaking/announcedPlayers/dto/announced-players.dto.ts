import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const objectId = z.string().min(1);

const announcedPlayerRoleSchema = z.enum([
  'batsman',
  'bowler',
  'allrounder',
  'wicket_keeper',
]);

const announcedPlayerSharedFields = {
  name: z.string().trim().min(1).max(200),
  avatar: z.string().trim().max(2000).optional(),
  email: z.string().trim().email().max(320).optional(),
  is_substitute: z.boolean().optional().default(false),
  role: announcedPlayerRoleSchema,
  isCaption: z.boolean().optional().default(false),
  isWiseCaption: z.boolean().optional().default(false),
};

/**
 * Roster: `isGuest` false (default) + `userId`.
 * Registered guest: `isGuest` true + `userId` (no `guestId`; server does not generate one).
 * Walk-in guest: `isGuest` true, no `userId` (server generates `guestId`).
 */
const AnnouncedPlayerCreateSchema = z
  .object({
    ...announcedPlayerSharedFields,
    userId: objectId.optional(),
    isGuest: z.boolean().optional().default(false),
  })
  .superRefine((val, ctx) => {
    if (!val.isGuest && !val.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'userId is required for roster members',
        path: ['userId'],
      });
    }
  });

const AddAnnouncedPlayersSchema = z.object({
  actorTeamId: objectId,
  players: z.array(AnnouncedPlayerCreateSchema).min(1).max(50),
});

const RemoveAnnouncedPlayersSchema = z
  .object({
    actorTeamId: objectId,
    userIds: z.array(objectId).max(50).optional().default([]),
    guestIds: z.array(objectId).max(50).optional().default([]),
  })
  .refine((d) => d.userIds.length + d.guestIds.length >= 1, {
    message: 'Provide userIds and/or guestIds',
  });

const AnnouncedPlayerUpdateRowSchema = z
  .object({
    userId: objectId.optional(),
    guestId: objectId.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    avatar: z.string().trim().max(2000).optional(),
    email: z.string().trim().email().max(320).optional(),
    is_substitute: z.boolean().optional(),
    role: announcedPlayerRoleSchema.optional(),
    isCaption: z.boolean().optional(),
    isWiseCaption: z.boolean().optional(),
  })
  .superRefine((row, ctx) => {
    const hasUser = !!row.userId;
    const hasGuest = !!row.guestId;
    if (hasUser === hasGuest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each update entry must set exactly one of userId or guestId',
        path: hasUser ? ['guestId'] : ['userId'],
      });
    }
    if (
      row.name === undefined &&
      row.avatar === undefined &&
      row.email === undefined &&
      row.is_substitute === undefined &&
      row.role === undefined &&
      row.isCaption === undefined &&
      row.isWiseCaption === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Each update entry must set at least one field to change besides the id',
      });
    }
  });

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
