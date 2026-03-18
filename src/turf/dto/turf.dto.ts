import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// Coordinates Schema
export const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

// Location Schema
export const LocationSchema = z.object({
  address: z.string().min(1, 'Address is required'),
  coordinates: CoordinatesSchema.optional(),
});

// Dimensions Schema
export const DimensionsSchema = z.object({
  length: z.number().min(0).optional(),
  width: z.number().min(0).optional(),
  unit: z.string().optional(),
});

// Pricing Schema
export const PricingSchema = z.object({
  basePricePerHour: z.number().min(0, 'Base price must be greater than or equal to 0'),
  weekendSurge: z.number().min(0).optional(),
});

// Operating Hours Schema
export const OperatingHoursSchema = z.object({
  open: z.string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Time must be in HH:MM format (24-hour)')
    .optional(),
  close: z.string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Time must be in HH:MM format (24-hour)')
    .optional(),
});

// Create Turf Schema
export const CreateTurfSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  location: LocationSchema,
  images: z.array(z.string()).optional(),
  amenities: z.array(z.string()).optional(),
  dimensions: DimensionsSchema.optional(),
  sportType: z.array(z.string()).min(1, 'At least one sport type is required'),
  pricing: PricingSchema,
  operatingHours: OperatingHoursSchema.optional(),
  isAvailable: z.boolean().optional(),
  slotBufferMins: z.number().min(0).max(120).optional(),
});

// Update Turf Schema (partial version of CreateTurfSchema)
export const UpdateTurfSchema = CreateTurfSchema.partial();

// DTO Classes using nestjs-zod
export class CreateTurfDto extends createZodDto(CreateTurfSchema) {}
export class UpdateTurfDto extends createZodDto(UpdateTurfSchema) {}