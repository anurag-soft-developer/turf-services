import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  dateRangeQueryFields,
  parseEnumQuery,
  parseStringArrayQuery,
} from '../../core/dto';
import {
  EventBookingStatus,
  PaymentStatus,
} from '../interfaces/event-booking.interface';

const CreateEventBookingSchema = z.object({
  fullName: z.string().min(1).max(200),
  contactNumber: z.string().min(8).max(20),
  notes: z.string().max(500).optional(),
  playerCount: z.number().int().min(1).max(50).optional(),
});

const UpdateEventBookingSchema = z.object({
  status: z.enum(EventBookingStatus).optional(),
  paymentStatus: z.enum(PaymentStatus).optional(),
  cancelReason: z.string().max(200).optional(),
});

const EventBookingFilterSchema = z.object({
  event: parseStringArrayQuery(),
  status: parseEnumQuery(z.enum(EventBookingStatus)),
  paymentStatus: z.enum(PaymentStatus).optional(),
  ...dateRangeQueryFields,
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).default(10),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});

const VerifyRazorpayPaymentSchema = z.object({
  bookingId: z.string().min(1),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

const CheckCapacitySchema = z.object({
  playerCount: z.number().int().min(1).max(50).default(1),
});

const CreateOrderQuerySchema = z.object({
  paymentLink: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

const VerifyRazorpayHostedPaymentSchema = z.object({
  bookingId: z.string().min(1),
  razorpay_payment_link_id: z.string().min(1),
  razorpay_payment_link_reference_id: z.string().min(1),
  razorpay_payment_link_status: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export class CreateEventBookingDto extends createZodDto(
  CreateEventBookingSchema,
) {}
export class UpdateEventBookingDto extends createZodDto(
  UpdateEventBookingSchema,
) {}
export class EventBookingFilterDto extends createZodDto(
  EventBookingFilterSchema,
) {}
export class VerifyEventRazorpayPaymentDto extends createZodDto(
  VerifyRazorpayPaymentSchema,
) {}
export class VerifyEventRazorpayHostedPaymentDto extends createZodDto(
  VerifyRazorpayHostedPaymentSchema,
) {}
export class CheckEventCapacityDto extends createZodDto(CheckCapacitySchema) {}
export class CreateOrderQueryDto extends createZodDto(CreateOrderQuerySchema) {}
