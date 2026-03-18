import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TurfBookingStatus, PaymentStatus } from '../interfaces/turf-booking.interface';

const CreateTurfBookingSchema = z.object({
  turf: z.string().min(1, 'Turf ID is required'),
  startTime: z.string().datetime('Invalid start time format'),
  endTime: z.string().datetime('Invalid end time format'),
  playerCount: z.number().min(1).max(50).optional(),
  notes: z.string().max(500).optional(),
});

const UpdateTurfBookingSchema = z.object({
//   startTime: z.string().datetime('Invalid start time format').optional(),
//   endTime: z.string().datetime('Invalid end time format').optional(),
  playerCount: z.number().min(1).max(50).optional(),
  notes: z.string().max(500).optional(),
  status: z.nativeEnum(TurfBookingStatus).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  paymentId: z.string().optional(),
  cancelReason: z.string().max(200).optional(),
});

const TurfBookingFilterSchema = z.object({
  turf: z.string().optional(),
  bookedBy: z.string().optional(),
  status: z.nativeEnum(TurfBookingStatus).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.number().min(1).default(1).optional(),
  limit: z.number().min(1).max(100).default(10).optional(),
  sortBy: z.string().default('createdAt').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});

const CheckTurfAvailabilitySchema = z.object({
  turf: z.string().min(1, 'Turf ID is required'),
  startTime: z.string().datetime('Invalid start time format'),
  endTime: z.string().datetime('Invalid end time format'),
  excludeBookingId: z.string().optional(),
});

export class CreateTurfBookingDto extends createZodDto(CreateTurfBookingSchema) {}
export class UpdateTurfBookingDto extends createZodDto(UpdateTurfBookingSchema) {}
export class TurfBookingFilterDto extends createZodDto(TurfBookingFilterSchema) {}
export class CheckTurfAvailabilityDto extends createZodDto(CheckTurfAvailabilitySchema) {}