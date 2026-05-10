import { Types } from 'mongoose';
import {
  CricketBallEvent,
  CricketWicketKind,
} from './cricket-over-event.schema';
import { CRICKET_POINT_WEIGHTS } from './cricket-point-weights';

/** Minimal over slice needed for points (bowler at over level). */
export type CricketOverPointsSlice = {
  bowlerUserId: Types.ObjectId;
  ballEvents: CricketBallEvent[];
};

export type PointsBreakdownEntry = { reason: string; points: number };

export type PlayerPointsRow = {
  userId: string;
  total: number;
  breakdown: PointsBreakdownEntry[];
};

function uid(id: Types.ObjectId): string {
  return id.toString();
}

export function computeCricketPlayerPoints(
  overs: CricketOverPointsSlice[],
): PlayerPointsRow[] {
  const byUser = new Map<string, PointsBreakdownEntry[]>();

  const add = (userId: string, reason: string, points: number) => {
    if (points === 0) return;
    const list = byUser.get(userId) ?? [];
    list.push({ reason, points });
    byUser.set(userId, list);
  };

  for (const over of overs) {
    const bowler = uid(over.bowlerUserId);
    for (const e of over.ballEvents) {
      const striker = uid(e.strikerUserId);

      if (e.runsOffBat > 0) {
        add(
          striker,
          'runs_off_bat',
          e.runsOffBat * CRICKET_POINT_WEIGHTS.battingRun,
        );
      }

      if (e.isLegalDelivery && e.runsOffBat === 0 && !e.isWicket) {
        const extras = e.extrasBye + e.extrasLegBye + (e.extrasWide > 0 ? 0 : 0);
        if (extras === 0) {
          add(bowler, 'dot_ball', CRICKET_POINT_WEIGHTS.bowlingDot);
        }
      }

      if (e.isWicket && e.wicketsFallen > 0) {
        if (e.wicketKind === CricketWicketKind.CAUGHT && e.primaryFielderUserId) {
          add(
            uid(e.primaryFielderUserId),
            'catch',
            CRICKET_POINT_WEIGHTS.fieldingCatch,
          );
          add(bowler, 'wicket_caught', CRICKET_POINT_WEIGHTS.bowlingWicket);
        } else if (
          e.wicketKind === CricketWicketKind.STUMPED &&
          e.primaryFielderUserId
        ) {
          add(
            uid(e.primaryFielderUserId),
            'stumping',
            CRICKET_POINT_WEIGHTS.fieldingStumping,
          );
          add(bowler, 'wicket_stumped', CRICKET_POINT_WEIGHTS.bowlingWicket);
        } else if (e.wicketKind === CricketWicketKind.RUN_OUT) {
          if (e.primaryFielderUserId) {
            add(
              uid(e.primaryFielderUserId),
              'run_out_assist',
              CRICKET_POINT_WEIGHTS.fieldingRunOutThrow,
            );
          }
        } else if (
          e.wicketKind === CricketWicketKind.BOWLED ||
          e.wicketKind === CricketWicketKind.LBW ||
          e.wicketKind === CricketWicketKind.HIT_WICKET
        ) {
          add(
            bowler,
            `wicket_${e.wicketKind}`,
            CRICKET_POINT_WEIGHTS.bowlingWicket,
          );
        } else if (e.wicketKind === CricketWicketKind.OTHER) {
          add(bowler, 'wicket_other', CRICKET_POINT_WEIGHTS.bowlingWicket);
        }
      }
    }
  }

  const rows: PlayerPointsRow[] = [];
  for (const [userId, breakdown] of byUser) {
    rows.push({
      userId,
      total: breakdown.reduce((s, b) => s + b.points, 0),
      breakdown,
    });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}
