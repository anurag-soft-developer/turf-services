import { Types } from 'mongoose';
import {
  FootballEventKind,
  FootballMatchEvent,
} from './football-match-event.schema';
import { FOOTBALL_POINT_WEIGHTS } from './football-point-weights';

export type FootballPointsBreakdownEntry = { reason: string; points: number };

export type FootballPlayerPointsRow = {
  userId: string;
  total: number;
  breakdown: FootballPointsBreakdownEntry[];
};

function uid(id: Types.ObjectId): string {
  return id.toString();
}

export function computeFootballPlayerPoints(
  events: FootballMatchEvent[],
): FootballPlayerPointsRow[] {
  const byUser = new Map<string, FootballPointsBreakdownEntry[]>();

  const add = (userId: string, reason: string, points: number) => {
    if (!userId || points === 0) return;
    const list = byUser.get(userId) ?? [];
    list.push({ reason, points });
    byUser.set(userId, list);
  };

  for (const e of events) {
    switch (e.kind) {
      case FootballEventKind.GOAL:
        if (e.primaryUserId) {
          add(uid(e.primaryUserId), 'goal', FOOTBALL_POINT_WEIGHTS.goal);
        }
        if (e.secondaryUserId) {
          add(uid(e.secondaryUserId), 'assist', FOOTBALL_POINT_WEIGHTS.assist);
        }
        break;
      case FootballEventKind.OWN_GOAL:
        if (e.primaryUserId) {
          add(
            uid(e.primaryUserId),
            'own_goal',
            FOOTBALL_POINT_WEIGHTS.ownGoalConceded,
          );
        }
        break;
      case FootballEventKind.YELLOW_CARD:
        if (e.primaryUserId) {
          add(
            uid(e.primaryUserId),
            'yellow_card',
            FOOTBALL_POINT_WEIGHTS.yellowCard,
          );
        }
        break;
      case FootballEventKind.RED_CARD:
        if (e.primaryUserId) {
          add(uid(e.primaryUserId), 'red_card', FOOTBALL_POINT_WEIGHTS.redCard);
        }
        break;
      case FootballEventKind.PENALTY_SCORED:
        if (e.primaryUserId) {
          add(
            uid(e.primaryUserId),
            'penalty_scored',
            FOOTBALL_POINT_WEIGHTS.penaltyScored,
          );
        }
        break;
      case FootballEventKind.PENALTY_MISSED:
        if (e.primaryUserId) {
          add(
            uid(e.primaryUserId),
            'penalty_missed',
            FOOTBALL_POINT_WEIGHTS.penaltyMissed,
          );
        }
        break;
      default:
        break;
    }
  }

  const rows: FootballPlayerPointsRow[] = [];
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
