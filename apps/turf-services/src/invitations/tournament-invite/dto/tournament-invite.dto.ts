import { createZodDto } from 'nestjs-zod';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  InvitationStatus,
  TournamentInvitationDirection,
} from '../../invitation.constants';

const objectId = z
  .string()
  .trim()
  .refine((value) => Types.ObjectId.isValid(value), 'Invalid id');

const CreateTournamentInvitationSchema = z.object({
  teamId: objectId,
  direction: z.enum(TournamentInvitationDirection),
});

const ListTournamentInvitationsSchema = z.object({
  status: z.enum(InvitationStatus).optional(),
  direction: z.enum(TournamentInvitationDirection).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export class CreateTournamentInvitationDto extends createZodDto(
  CreateTournamentInvitationSchema,
) {}

export class ListTournamentInvitationsDto extends createZodDto(
  ListTournamentInvitationsSchema,
) {}
