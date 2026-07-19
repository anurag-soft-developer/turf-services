import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SendFollowingRequestSchema = z.object({
  recipientId: z.string().min(1, 'Recipient is required'),
  recipientType: z.enum(['User', 'Team']).default('User'),
});

const FollowingFilterSchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  direction: z.enum(['incoming', 'outgoing', 'all']).default('all').optional(),
  recipientType: z.enum(['User', 'Team']).optional(),
  recipientId: z.string().min(1).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const ResolveFollowingRequestSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});

const FriendsPaginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const SendFollowingRequestDtoBase: ZodDto<typeof SendFollowingRequestSchema> =
  createZodDto(SendFollowingRequestSchema);
const FollowingFilterDtoBase: ZodDto<typeof FollowingFilterSchema> =
  createZodDto(FollowingFilterSchema);
const ResolveFollowingRequestDtoBase: ZodDto<
  typeof ResolveFollowingRequestSchema
> = createZodDto(ResolveFollowingRequestSchema);
const FriendsPaginationDtoBase: ZodDto<typeof FriendsPaginationSchema> =
  createZodDto(FriendsPaginationSchema);

export class SendFollowingRequestDto extends SendFollowingRequestDtoBase {}
export class FollowingFilterDto extends FollowingFilterDtoBase {}
export class ResolveFollowingRequestDto extends ResolveFollowingRequestDtoBase {}
export class FriendsPaginationDto extends FriendsPaginationDtoBase {}
