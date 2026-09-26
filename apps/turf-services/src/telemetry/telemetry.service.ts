import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TelemetryBatchDto } from './dto/telemetry.dto';
import { ClientLog } from './schemas/client-log.schema';

@Injectable()
export class TelemetryService {
  constructor(
    @InjectModel(ClientLog.name)
    private readonly clientLogModel: Model<ClientLog>,
  ) {}

  async ingestBatch(
    userId: string | null,
    events: TelemetryBatchDto['events'],
  ): Promise<void> {
    const userObjectId =
      userId && Types.ObjectId.isValid(userId)
        ? new Types.ObjectId(userId)
        : null;

    const docs = events.map((event) => ({
      appId: event.appId,
      platform: event.platform,
      appVersion: event.appVersion,
      installId: event.installId,
      sessionId: event.sessionId,
      userId: userObjectId,
      kind: event.kind,
      name: event.name,
      level: event.level,
      occurredAt: event.occurredAt,
      durationMs: event.durationMs,
      count: event.count,
      clientEventId: event.clientEventId,
      payload: event.payload,
    }));

    try {
      await this.clientLogModel.insertMany(docs, { ordered: false });
    } catch (error) {
      if (!isDuplicateKeyOnly(error)) {
        throw error;
      }
    }
  }
}

function isDuplicateKeyOnly(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const bulk = error as {
    code?: number;
    writeErrors?: Array<{ code?: number }>;
  };
  if (bulk.writeErrors && bulk.writeErrors.length > 0) {
    return bulk.writeErrors.every((entry) => entry.code === 11000);
  }
  return bulk.code === 11000;
}
