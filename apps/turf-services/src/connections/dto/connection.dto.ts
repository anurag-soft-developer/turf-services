import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SendConnectionRequestSchema = z.object({
  recipientId: z.string().min(1, 'Recipient is required'),
});

const ConnectionFilterSchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  direction: z.enum(['incoming', 'outgoing', 'all']).default('all').optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const ResolveConnectionRequestSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});

const SendConnectionRequestDtoBase: ZodDto<typeof SendConnectionRequestSchema> =
  createZodDto(SendConnectionRequestSchema);
const ConnectionFilterDtoBase: ZodDto<typeof ConnectionFilterSchema> =
  createZodDto(ConnectionFilterSchema);
const ResolveConnectionRequestDtoBase: ZodDto<
  typeof ResolveConnectionRequestSchema
> = createZodDto(ResolveConnectionRequestSchema);

export class SendConnectionRequestDto extends SendConnectionRequestDtoBase {}
export class ConnectionFilterDto extends ConnectionFilterDtoBase {}
export class ResolveConnectionRequestDto extends ResolveConnectionRequestDtoBase {}
