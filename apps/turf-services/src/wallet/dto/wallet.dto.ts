import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PayoutMethod } from '../interfaces/wallet.interface';

const UpdatePayoutDetailsSchema = z
  .object({
    primaryMethod: z.enum(PayoutMethod).optional(),
    accountHolderName: z.string().trim().min(2).max(120).optional(),
    bankName: z.string().trim().min(2).max(120).optional(),
    accountNumber: z
      .string()
      .trim()
      .min(6)
      .max(34)
      .regex(/^[0-9]+$/, 'Account number must contain digits only')
      .optional(),
    ifscCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code')
      .optional(),
    upiId: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9.\-_]{2,256}@[a-z]{2,64}$/, 'Invalid UPI ID')
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).some(
        (key) => value[key as keyof typeof value] !== undefined,
      ),
    {
      message: 'At least one payout field must be provided',
    },
  );

export class UpdatePayoutDetailsDto extends createZodDto(
  UpdatePayoutDetailsSchema,
) {}
