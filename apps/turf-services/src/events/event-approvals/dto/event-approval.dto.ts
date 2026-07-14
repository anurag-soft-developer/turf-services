import { z } from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';

export const EventReviewActionSchema = z.enum(['publish', 'reject']);

export const ReviewEventSchema = z
  .object({
    action: EventReviewActionSchema,
    rejectionReason: z.string().min(1).max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'reject' && !data.rejectionReason?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Rejection reason is required when rejecting an event',
        path: ['rejectionReason'],
      });
    }
  });

export class ReviewEventDto extends createZodDto(ReviewEventSchema) {}
