import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AnnouncedPlayerRole } from '../../announcedPlayers/announced-players.schema';

const objectId = z.string().min(1);
const announcedPlayerRoleSchema = z.enum(AnnouncedPlayerRole);

const UpdateGuestJoinSettingsSchema = z.object({
  actorTeamId: objectId,
  open: z.boolean(),
  /** Match-level cap shared by both sides. 0 disables the cap. */
  maxPerTeam: z.number().int().min(0).max(50).optional(),
});

/** Omit `teamId` to auto-pick the open side with fewer players; pass it to switch sides. */
const GuestJoinSchema = z.object({
  teamId: objectId.optional(),
  role: announcedPlayerRoleSchema.optional(),
});

export class UpdateGuestJoinSettingsDto extends createZodDto(
  UpdateGuestJoinSettingsSchema,
) {}
export class GuestJoinDto extends createZodDto(GuestJoinSchema) {}
