import { z } from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';
import {
  date,
  geoLocationSchema,
  geoLocationPartialSchema,
  nearbyLocationQuerySchema,
} from '../../core/dto';
import { EventStatus } from '../interfaces/event.interface';

const eventStatusSchema = z.enum(EventStatus);

export const CreateEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10000),
  coverImages: z.array(z.string()).optional(),
  eventDate: date,
  reportingTime: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .optional(),
  location: geoLocationSchema,
  price: z.number().min(0).default(0),
  currency: z.string().min(3).max(3).default('INR').optional(),
  maxParticipants: z.number().int().min(1),
  turf: z.string().optional(),
  registrationsPaused: z.boolean().optional(),
});

export const UpdateEventSchema = CreateEventSchema.partial().extend({
  location: geoLocationPartialSchema.optional(),
  archive: z.boolean().optional(),
  registrationsPaused: z.boolean().optional(),
});

export const SearchEventSchema = z.object({
  createdBy: z.string().optional(),
  globalSearchText: z.string().optional(),
  status: eventStatusSchema.optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  location: nearbyLocationQuerySchema.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc').optional(),
});

export class CreateEventDto extends createZodDto(CreateEventSchema) {}
export class UpdateEventDto extends createZodDto(UpdateEventSchema) {}
export class SearchEventDto extends createZodDto(SearchEventSchema) {}
