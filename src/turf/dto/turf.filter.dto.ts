import { z } from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';
import { nearbyLocationQuerySchema } from '../../core/dto';

// Pricing Filter Schema
export const PricingFilterSchema = z.object({
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  includeWeekendSurge: z.boolean().optional(),
}).transform((data) => ({
  ...data,
  minPrice: data.minPrice ? Number(data.minPrice) : undefined,
  maxPrice: data.maxPrice ? Number(data.maxPrice) : undefined,
  includeWeekendSurge: data.includeWeekendSurge === true,
}));

// Search Turf Schema
export const SearchTurfSchema = z.object({
  postedBy: z.string().optional(),
  globalSearchText: z.string().optional(),
  sportTypes: z.union([
    z.string().transform((val) => val.split(',').map(v => v.trim())),
    z.array(z.string())
  ]).optional(),
  amenities: z.union([
    z.string().transform((val) => val.split(',').map(v => v.trim())),
    z.array(z.string())
  ]).optional(),
  location: nearbyLocationQuerySchema.optional(),
  pricing: PricingFilterSchema.optional(),
  isAvailable: z.union([
    z.boolean(),
    z.string().transform((val) => val === 'true')
  ]).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  operatingTime: z.string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Operating time must be in HH:mm format')
    .optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  sort: z.string().optional(),
});


export class SearchTurfDto extends  createZodDto(SearchTurfSchema) {}