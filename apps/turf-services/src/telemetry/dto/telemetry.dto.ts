import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  TELEMETRY_APP_IDS,
  TELEMETRY_BATCH_LIMIT,
  TELEMETRY_KINDS,
  TELEMETRY_LEVELS,
  TELEMETRY_PAYLOAD_MAX_BYTES,
} from '../telemetry.constants';

const payloadWithinLimit = (value: Record<string, unknown>) =>
  Buffer.byteLength(JSON.stringify(value), 'utf8') <=
  TELEMETRY_PAYLOAD_MAX_BYTES;

const ClientLogEventSchema = z
  .object({
    appId: z.enum(TELEMETRY_APP_IDS),
    platform: z.string().trim().min(1).max(32).optional(),
    appVersion: z.string().trim().min(1).max(64).optional(),
    installId: z.string().trim().min(1).max(64).optional(),
    sessionId: z.string().trim().min(1).max(64).optional(),
    kind: z.enum(TELEMETRY_KINDS),
    name: z.string().trim().min(1).max(200).optional(),
    level: z.enum(TELEMETRY_LEVELS).optional(),
    occurredAt: z.coerce.date(),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60 * 60 * 1000)
      .optional(),
    count: z.number().int().min(1).max(1000).default(1),
    clientEventId: z.uuid(),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .default({})
      .refine(payloadWithinLimit, 'payload exceeds 4 KB'),
  })
  .strict();

const TelemetryBatchSchema = z
  .object({
    events: z.array(ClientLogEventSchema).min(1).max(TELEMETRY_BATCH_LIMIT),
  })
  .strict();

export class TelemetryBatchDto extends createZodDto(TelemetryBatchSchema) {}
