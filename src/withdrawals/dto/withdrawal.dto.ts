import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  PayoutMethod,
  WalletType,
} from '../../wallet/interfaces/wallet.interface';
import { WithdrawalStatus } from '../interfaces/withdrawal.interface';

const attachmentSchema = z.string().url().max(2000);

const CreateWithdrawalRequestSchema = z.object({
  walletType: z.enum(WalletType),
  amount: z.coerce.number().min(1),
});

const WithdrawalFilterSchema = z.object({
  status: z.enum(WithdrawalStatus).optional(),
  walletType: z.enum(WalletType).optional(),
  userId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const UpdateWithdrawalStatusSchema = z
  .object({
    status: z.enum(WithdrawalStatus),
    rejectionReason: z.string().trim().min(1).max(1000).optional(),
    paidViaMethod: z.enum(PayoutMethod).optional(),
  })
  .refine(
    (data) =>
      data.status !== WithdrawalStatus.SETTLED ||
      data.paidViaMethod !== undefined,
    {
      message: 'paidViaMethod is required when status is settled',
      path: ['paidViaMethod'],
    },
  );

const AddWithdrawalCommentSchema = z.object({
  message: z.string().trim().min(1).max(1000),
});

const AddWithdrawalAttachmentsSchema = z.object({
  attachments: z.array(attachmentSchema).min(1).max(10),
});

const UpdateWithdrawalPayoutSnapshotSchema = z.object({
  method: z.enum(PayoutMethod),
});

export class CreateWithdrawalRequestDto extends createZodDto(
  CreateWithdrawalRequestSchema,
) {}
export class WithdrawalFilterDto extends createZodDto(WithdrawalFilterSchema) {}
export class UpdateWithdrawalStatusDto extends createZodDto(
  UpdateWithdrawalStatusSchema,
) {}
export class AddWithdrawalCommentDto extends createZodDto(
  AddWithdrawalCommentSchema,
) {}
export class AddWithdrawalAttachmentsDto extends createZodDto(
  AddWithdrawalAttachmentsSchema,
) {}
