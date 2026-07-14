import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReconcileStorageBodySchema = z.object({
  dryRun: z.boolean().optional().default(true),
});

export class ReconcileStorageBodyDto extends createZodDto(
  ReconcileStorageBodySchema,
) {}
