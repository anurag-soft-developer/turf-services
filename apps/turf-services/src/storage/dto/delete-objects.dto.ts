import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DeleteObjectsBodySchema = z
  .object({
    objectKeys: z.union([
      z.array(z.string().trim().min(1).max(1024)),
      z.string().trim().min(1).max(1024),
    ]),
  })
  .transform((data) => {
    if (Array.isArray(data.objectKeys)) {
      return { objectKeys: data.objectKeys };
    }
    return { objectKeys: [data.objectKeys] };
  });

export class DeleteObjectsBodyDto extends createZodDto(
  DeleteObjectsBodySchema,
) {}
