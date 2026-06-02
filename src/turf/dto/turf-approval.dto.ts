import { z } from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';

export const TurfReviewActionSchema = z.enum(['publish', 'reject']);

export const ReviewTurfSchema = z
  .object({
    action: TurfReviewActionSchema,
    rejectionReason: z.string().min(1).max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'reject' && !data.rejectionReason?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Rejection reason is required when rejecting a turf',
        path: ['rejectionReason'],
      });
    }
  });

export class ReviewTurfDto extends createZodDto(ReviewTurfSchema) {}
