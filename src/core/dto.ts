import z from 'zod';

export const date = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), 'Invalid start time format');
