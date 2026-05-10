import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { config } from '../../core/config/env.config';
import {
  scoringUpdatePayloadSchema,
  type ScoringAction,
  type ScoringSport,
  type ScoringUpdatePayload,
} from '../../package';

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

    const base = config.REALTIME_TURF_BASE_URL?.replace(/\/$/, '');
    const token = config.SCORING_INTERNAL_TOKEN;
    if (!base || !token) {
      this.logger.warn(
        'Realtime scoring dispatch skipped: REALTIME_TURF_BASE_URL or SCORING_INTERNAL_TOKEN not set',
      );
      return payload;
    }

    try {
      const res = await fetch(`${base}/internal/scoring/dispatch`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        this.logger.warn(
          `Realtime scoring dispatch failed: HTTP ${res.status}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Realtime scoring dispatch error: ${(error as Error).message}`,
      );
    }

    return payload;
  }
}
