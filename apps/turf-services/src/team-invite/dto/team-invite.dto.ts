import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { normalizePhone } from '../../core/utils/phone.util';

const optionalEmail = z.email('Please provide a valid email address').optional();

const optionalPhone = z.preprocess((val) => {
  if (val === undefined || val === null || val === '') {
    return undefined;
  }
  if (typeof val !== 'string') {
    return val;
  }
  return normalizePhone(val);
}, z.string().optional());

const teamInviteStatusSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'expired',
  'revoked',
]);

const CreateTeamInviteSchema = z
  .object({
    email: optionalEmail,
    phone: optionalPhone,
    inviteeUserId: z.string().trim().min(1).optional(),
  })
  .refine(
    (data) =>
      [data.email, data.phone, data.inviteeUserId].filter(Boolean).length === 1,
    {
      message: 'Provide exactly one of email, phone, or inviteeUserId',
      path: ['email'],
    },
  );

const TeamInviteFilterSchema = z.object({
  status: teamInviteStatusSchema.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const MyInvitesFilterSchema = z.object({
  status: teamInviteStatusSchema.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export class CreateTeamInviteDto extends createZodDto(CreateTeamInviteSchema) {}
export class TeamInviteFilterDto extends createZodDto(TeamInviteFilterSchema) {}
export class MyInvitesFilterDto extends createZodDto(MyInvitesFilterSchema) {}
