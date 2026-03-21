import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const CreateAppMetadataSchema = z.object({
  sports: z
    .array(z.string().trim().min(1, 'Sport name cannot be empty'))
    .min(1, 'At least one sport is required'),
});

const UpdateAppMetadataSchema = CreateAppMetadataSchema.partial(); // All fields optional for update

export class CreateAppMetadataDto extends createZodDto(
  CreateAppMetadataSchema,
) {}
export class UpdateAppMetadataDto extends createZodDto(
  UpdateAppMetadataSchema,
) {}
