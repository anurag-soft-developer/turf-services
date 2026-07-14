import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const fcmTokenEntrySchema = z.object({
  deviceKey: z.string().trim().min(1).max(120),
  token: z.string().trim().min(1).max(500),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

export type FcmTokenEntryPayload = z.infer<typeof fcmTokenEntrySchema>;

const ReplaceFcmDevicesSchema = z
  .object({
    devices: z.array(fcmTokenEntrySchema).max(20),
  })
  .strict();

const UpsertFcmDeviceSchema = fcmTokenEntrySchema;

export class ReplaceFcmDevicesDto extends createZodDto(
  ReplaceFcmDevicesSchema,
) {}
export class UpsertFcmDeviceDto extends createZodDto(UpsertFcmDeviceSchema) {}
