import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const addressSchema = z.object({
  street1: z.string().min(1, 'Street address is required'),
  street2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postalCode: z.string().min(4, 'Postal code is required'),
  country: z.string().length(2).default('IN'),
});

const ApplyHostOnboardingSchema = z.object({
  legalBusinessName: z.string().min(4).max(200),
  contactName: z.string().min(4).max(255),
  phone: z.string().min(8).max(15),
  businessType: z.enum([
    'individual',
    'proprietorship',
    'partnership',
    'private_limited',
    'public_limited',
    'llp',
    'trust',
    'society',
    'ngo',
    'not_yet_registered',
    'educational_institutes',
    'other',
  ]),
  category: z.string().min(1),
  subcategory: z.string().min(1),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format'),
  gst: z.string().optional(),
  registeredAddress: addressSchema,
  bankAccountNumber: z.string().min(5).max(35),
  bankIfsc: z
    .string()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC format'),
  bankBeneficiaryName: z.string().min(1).max(120),
});

export class ApplyHostOnboardingDto extends createZodDto(
  ApplyHostOnboardingSchema,
) {}
