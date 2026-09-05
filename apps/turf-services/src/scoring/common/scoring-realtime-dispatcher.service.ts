import { Injectable, Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { randomUUID } from 'crypto';
import { config } from '../../core/config/env.config';
import { internalHttp } from '../../core/http/http.client';
import {
  scoringUpdatePayloadSchema,
  type ScoringAction,
  type ScoringSport,
  type ScoringUpdatePayload,
} from '../../../../../libs';

interface DispatchInput {
  sport: ScoringSport;
  teamMatchId: string;
  actorUserId: string;
  action: ScoringAction;
  data: Record<string, unknown>;
}

@Injectable()
export class ScoringRealtimeDispatcher {
  private readonly logger = new Logger(ScoringRealtimeDispatcher.name);

  /**
   * Persists nothing; just notifies the realtime service so it can broadcast
   * a `scoring.update` event to every client in the session room.
   *
   * Failures here are logged but never thrown so a flaky realtime service
   * doesn't roll back a successful HTTP write.
   */
  async dispatch(input: DispatchInput): Promise<ScoringUpdatePayload | null> {
    const payload: ScoringUpdatePayload = {
      eventId: randomUUID(),
      sport: input.sport,
      teamMatchId: input.teamMatchId,
      actorUserId: input.actorUserId,
      action: input.action,
      data: input.data,
      createdAt: new Date().toISOString(),
    };

    const parsed = scoringUpdatePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn(
        `Skipping realtime dispatch: invalid scoring payload ${parsed.error.message}`,
      );
      return null;
    }

    if (!config.REALTIME_TURF_BASE_URL) {
      this.logger.warn(
        'Realtime scoring dispatch skipped: REALTIME_TURF_BASE_URL not set',
      );
      return payload;
    }

    try {
      await internalHttp.post('/internal/scoring/dispatch', parsed.data);
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(
        status
          ? `Realtime scoring dispatch failed: HTTP ${status}`
          : `Realtime scoring dispatch error: ${
              error instanceof Error ? error.message : String(error)
            }`,
      );
    }

    return payload;
  }
}
