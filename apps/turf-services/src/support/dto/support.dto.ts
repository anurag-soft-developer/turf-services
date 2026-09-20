import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { normalizePhone } from '../../core/utils/phone.util';
import { SupportQueryStatus } from '../interfaces/support.interface';

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

const exactlyOneContactRefine = {
  message: 'Provide exactly one of email or phone',
  path: ['email'] as (string | number)[],
};

const CreateSupportQuerySchema = z
  .object({
    email: optionalEmail,
    phone: optionalPhone,
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(4000),
  })
  .refine(
    (data) => Boolean(data.email) !== Boolean(data.phone),
    exactlyOneContactRefine,
  );

const SupportQueryFilterSchema = z.object({
  status: z.enum(SupportQueryStatus).optional(),
  userId: z.string().optional(),
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const AddSupportReplySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

const AddSupportInternalNoteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

const UpdateSupportQueryStatusSchema = z.object({
  status: z.enum(SupportQueryStatus),
});

export class CreateSupportQueryDto extends createZodDto(
  CreateSupportQuerySchema,
) {}
export class SupportQueryFilterDto extends createZodDto(
  SupportQueryFilterSchema,
) {}
export class AddSupportReplyDto extends createZodDto(AddSupportReplySchema) {}
export class AddSupportInternalNoteDto extends createZodDto(
  AddSupportInternalNoteSchema,
) {}
export class UpdateSupportQueryStatusDto extends createZodDto(
  UpdateSupportQueryStatusSchema,
) {}
