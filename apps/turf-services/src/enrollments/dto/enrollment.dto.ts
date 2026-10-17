import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const enrollmentStatusSchema = z.enum(['pending', 'accepted', 'rejected']);

const EnrollSchema = z.object({
  teamId: z.string().trim().min(1).optional(),
});

const EnrollmentListSchema = z.object({
  status: enrollmentStatusSchema.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

const WithdrawEnrollmentSchema = z.object({
  teamId: z.string().trim().min(1).optional(),
});

export class EnrollDto extends createZodDto(EnrollSchema) {}
export class EnrollmentListDto extends createZodDto(EnrollmentListSchema) {}
export class WithdrawEnrollmentDto extends createZodDto(
  WithdrawEnrollmentSchema,
) {}
