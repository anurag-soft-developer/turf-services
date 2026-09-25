import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TermsAndConditionsKind } from '../interfaces/terms-and-conditions.interface';

const TermsKindQuerySchema = z.object({
  kind: z.enum(TermsAndConditionsKind),
});

const CreateTermsAndConditionsSchema = z.object({
  kind: z.enum(TermsAndConditionsKind),
  version: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50000),
});

const UpdateTermsAndConditionsSchema = z.object({
  version: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50000),
});

export class TermsKindQueryDto extends createZodDto(TermsKindQuerySchema) {}
export class CreateTermsAndConditionsDto extends createZodDto(
  CreateTermsAndConditionsSchema,
) {}
export class UpdateTermsAndConditionsDto extends createZodDto(
  UpdateTermsAndConditionsSchema,
) {}
