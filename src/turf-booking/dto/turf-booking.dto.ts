import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TurfBookingStatus, PaymentStatus } from '../interfaces/turf-booking.interface';
import { date } from '../../core/dto';

const TimeSlotSchema = z.object({
  startTime: date,
  endTime: date,
});

const CreateTurfBookingSchema = z.object({
  turf: z.string().min(1, 'Turf ID is required'),
  timeSlots: z.array(TimeSlotSchema).min(1, 'At least one time slot is required'),
  playerCount: z.number().min(1).max(50).optional(),
  notes: z.string().max(500).optional(),
});

const UpdateTurfBookingSchema = z.object({
  timeSlots: z.array(TimeSlotSchema).min(1, 'At least one time slot is required').optional(),
  playerCount: z.number().min(1).max(50).optional(),
  notes: z.string().max(500).optional(),
  status: z.enum(TurfBookingStatus).optional(),
  paymentStatus: z.enum(PaymentStatus).optional(),
  paymentId: z.string().optional(),
  cancelReason: z.string().max(200).optional(),
});

const TurfBookingFilterSchema = z.object({
  turf: z.string().optional(),
  bookedBy: z.string().optional(),
  status: z.enum(TurfBookingStatus).optional(),
  paymentStatus: z.enum(PaymentStatus).optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).default(10),
  sortBy: z.string().default('createdAt').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});

const CheckTurfAvailabilitySchema = z.object({
  turf: z.string().min(1, 'Turf ID is required'),
  timeSlots: z.array(TimeSlotSchema).min(1, 'At least one time slot is required'),
  excludeBookingId: z.string().optional(),
});

export class CreateTurfBookingDto extends createZodDto(CreateTurfBookingSchema) {}
export class UpdateTurfBookingDto extends createZodDto(UpdateTurfBookingSchema) {}
export class TurfBookingFilterDto extends createZodDto(TurfBookingFilterSchema) {}
export class CheckTurfAvailabilityDto extends createZodDto(CheckTurfAvailabilitySchema) {}