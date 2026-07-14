import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const RazorpayWebhookPayloadSchema = z.object({
  event: z.string().min(1, 'Webhook event is required'),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export class RazorpayWebhookPayloadDto extends createZodDto(
  RazorpayWebhookPayloadSchema,
) {}
