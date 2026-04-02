import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { date } from '../../core/dto';

const CreateTurfReviewSchema = z.object({
  turf: z.string().min(1, 'Turf ID is required'),
  rating: z.number().min(1, 'Rating must be at least 1').max(5, 'Rating must be at most 5'),
  title: z.string().trim().max(100, 'Title must be at most 100 characters').optional(),
  comment: z.string().trim().max(1000, 'Comment must be at most 1000 characters').optional(),
  images: z.array(z.string().url('Invalid image URL')).max(5, 'Maximum 5 images allowed').optional(),
  visitDate:date.optional(),
}).refine(data => data.title || data.comment || (data.images && data.images.length > 0), {
  message: 'At least one of title, comment, or images must be provided',
});

const UpdateTurfReviewSchema = z.object({
  rating: z.number().min(1, 'Rating must be at least 1').max(5, 'Rating must be at most 5').optional(),
  title: z.string().trim().max(100, 'Title must be at most 100 characters').optional(),
  comment: z.string().trim().max(1000, 'Comment must be at most 1000 characters').optional(),
  images: z.array(z.string().url('Invalid image URL')).max(5, 'Maximum 5 images allowed').optional(),
  visitDate: date.optional(),
  isModerated: z.boolean().optional(),
  moderatedBy: z.string().optional(),
});

const TurfReviewFilterSchema = z.object({
  turf: z.string().optional(),
  reviewedBy: z.string().optional(),
  rating: z.coerce.number().min(1).max(5).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  maxRating: z.coerce.number().min(1).max(5).optional(),
  isVerifiedBooking: z.boolean().optional(),
  isModerated: z.boolean().optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).default(10),
  sortBy: z.enum(['createdAt', 'rating', 'helpfulVotes']).default('createdAt').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});

const VoteReviewSchema = z.object({
  helpful: z.boolean(), // true for helpful, false for not helpful
});

const ReportReviewSchema = z.object({
  reason: z.string().trim().min(1, 'Report reason is required').max(200, 'Reason must be at most 200 characters'),
});

const ModerateReviewSchema = z.object({
  isModerated: z.boolean(),
  reason: z.string().trim().max(500, 'Moderation reason must be at most 500 characters').optional(),
});

const CreateTurfReviewDtoBase: ZodDto<typeof CreateTurfReviewSchema> = createZodDto(CreateTurfReviewSchema);
const UpdateTurfReviewDtoBase: ZodDto<typeof UpdateTurfReviewSchema> = createZodDto(UpdateTurfReviewSchema);
const TurfReviewFilterDtoBase: ZodDto<typeof TurfReviewFilterSchema> = createZodDto(TurfReviewFilterSchema);
const VoteReviewDtoBase: ZodDto<typeof VoteReviewSchema> = createZodDto(VoteReviewSchema);
const ReportReviewDtoBase: ZodDto<typeof ReportReviewSchema> = createZodDto(ReportReviewSchema);
const ModerateReviewDtoBase: ZodDto<typeof ModerateReviewSchema> = createZodDto(ModerateReviewSchema);

export class CreateTurfReviewDto extends CreateTurfReviewDtoBase {}
export class UpdateTurfReviewDto extends UpdateTurfReviewDtoBase {}
export class TurfReviewFilterDto extends TurfReviewFilterDtoBase {}
export class VoteReviewDto extends VoteReviewDtoBase {}
export class ReportReviewDto extends ReportReviewDtoBase {}
export class ModerateReviewDto extends ModerateReviewDtoBase {}