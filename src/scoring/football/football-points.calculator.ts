import { Types } from 'mongoose';
import type {
  MatchRankingPointsSnapshot,
  RankingPointsBreakdownEntry,
} from '../../core/points/ranking-points.types';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import {
  FootballEventKind,
  FootballMatchEvent,
} from './football-match-event.schema';
import {
  FOOTBALL_PLAYER_RESULT_BONUS,
  FOOTBALL_POINT_WEIGHTS,
  FOOTBALL_TEAM_RESULT_BONUS,
} from './football-point-weights';

export type FootballPointsBreakdownEntry = RankingPointsBreakdownEntry;

export type FootballPlayerPointsRow = {
  userId: string;
  teamId: string;
  total: number;
  breakdown: FootballPointsBreakdownEntry[];
};

export type FootballTeamPointsRow = {
  teamId: string;
  total: number;
  breakdown: FootballPointsBreakdownEntry[];
};

export type FootballMatchRankingPointsResult = {
  players: FootballPlayerPointsRow[];
  teams: FootballTeamPointsRow[];
};

export type ComputeFootballRankingOptions = {
  /** When false, omit player result and team result bonuses (live preview). */
  includeResultBonuses?: boolean;
};

function uid(id: Types.ObjectId): string {
  return id.toString();
}

function teamFromAnnounced(
  match: TeamMatchDocument,
  userId: string,
): string | undefined {
  for (const p of match.announcedPlayers ?? []) {
    if (p.userId.toString() === userId) {
      return p.teamId.toString();
    }
  }
  return undefined;
}

function resolvePlayerTeam(
  match: TeamMatchDocument,
  userId: string,
  eventTeamByUser: Map<string, string>,
): string {
  const fromAnnounced = teamFromAnnounced(match, userId);
  if (fromAnnounced) {
    return fromAnnounced;
  }
  const fromEvent = eventTeamByUser.get(userId);
  if (fromEvent) {
    return fromEvent;
  }
  return match.fromTeam.toString();
}

function playerResultBonus(
  teamId: string,
  winnerTeamId: string | null,
  isDraw: boolean,
): number {
  if (isDraw) {
    return FOOTBALL_PLAYER_RESULT_BONUS.draw;
  }
  if (!winnerTeamId) {
    return 0;
  }
  return teamId === winnerTeamId
    ? FOOTBALL_PLAYER_RESULT_BONUS.win
    : FOOTBALL_PLAYER_RESULT_BONUS.loss;
}

function teamResultBonus(
  teamId: string,
  winnerTeamId: string | null,
  isDraw: boolean,
): number {
  if (isDraw) {
    return FOOTBALL_TEAM_RESULT_BONUS.draw;
  }
  if (!winnerTeamId) {
    return FOOTBALL_TEAM_RESULT_BONUS.draw;
  }
  return teamId === winnerTeamId
    ? FOOTBALL_TEAM_RESULT_BONUS.win
    : FOOTBALL_TEAM_RESULT_BONUS.loss;
}

export function computeFootballMatchRankingPoints(
  match: TeamMatchDocument,
  events: FootballMatchEvent[],
  winnerTeamId: string | null,
  isDraw: boolean,
  options: ComputeFootballRankingOptions = {},
): FootballMatchRankingPointsResult {
  const includeResultBonuses = options.includeResultBonuses ?? true;
  const fromId = match.fromTeam.toString();
  const toId = match.toTeam.toString();

  const byUser = new Map<string, FootballPointsBreakdownEntry[]>();
  const userTeams = new Map<string, string>();
  const eventTeamByUser = new Map<string, string>();

  const add = (userId: string, reason: string, points: number) => {
    if (points === 0) return;
    const list = byUser.get(userId) ?? [];
    list.push({ reason, points });
    byUser.set(userId, list);
  };

  for (const e of events) {
    const benTeam = uid(e.beneficiaryTeamId);
    if (e.primaryUserId) {
      eventTeamByUser.set(uid(e.primaryUserId), benTeam);
    }
    if (e.secondaryUserId) {
      eventTeamByUser.set(uid(e.secondaryUserId), benTeam);
    }

    switch (e.kind) {
      case FootballEventKind.GOAL:
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          userTeams.set(userId, teamId);
          add(userId, 'goal', FOOTBALL_POINT_WEIGHTS.goal);
        }
        if (e.secondaryUserId) {
          const userId = uid(e.secondaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          userTeams.set(userId, teamId);
          add(userId, 'assist', FOOTBALL_POINT_WEIGHTS.assist);
        }
        break;
      case FootballEventKind.OWN_GOAL:
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const concedingTeam = benTeam === fromId ? toId : fromId;
          eventTeamByUser.set(userId, concedingTeam);
          userTeams.set(userId, concedingTeam);
          add(userId, 'own_goal', FOOTBALL_POINT_WEIGHTS.ownGoalConceded);
        }
        break;
      case FootballEventKind.YELLOW_CARD:
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          userTeams.set(userId, teamId);
          add(userId, 'yellow_card', FOOTBALL_POINT_WEIGHTS.yellowCard);
        }
        break;
      case FootballEventKind.RED_CARD:
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          userTeams.set(userId, teamId);
          add(userId, 'red_card', FOOTBALL_POINT_WEIGHTS.redCard);
        }
        break;
      case FootballEventKind.PENALTY_SCORED:
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          userTeams.set(userId, teamId);
          add(userId, 'penalty_scored', FOOTBALL_POINT_WEIGHTS.penaltyScored);
        }
        break;
      case FootballEventKind.PENALTY_MISSED:
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          userTeams.set(userId, teamId);
          add(userId, 'penalty_missed', FOOTBALL_POINT_WEIGHTS.penaltyMissed);
        }
        break;
      default:
        break;
    }
  }

  if (includeResultBonuses) {
    for (const userId of byUser.keys()) {
      const teamId =
        userTeams.get(userId) ??
        resolvePlayerTeam(match, userId, eventTeamByUser);
      userTeams.set(userId, teamId);
      const bonus = playerResultBonus(teamId, winnerTeamId, isDraw);
      if (bonus !== 0) {
        add(userId, 'match_result', bonus);
      }
    }
  }

  const players: FootballPlayerPointsRow[] = [];
  for (const [userId, breakdown] of byUser) {
    const teamId =
      userTeams.get(userId) ??
      resolvePlayerTeam(match, userId, eventTeamByUser);
    players.push({
      userId,
      teamId,
      total: breakdown.reduce((s, b) => s + b.points, 0),
      breakdown,
    });
  }
  players.sort((a, b) => b.total - a.total);

  const teamBreakdown = new Map<string, FootballPointsBreakdownEntry[]>();
  const addTeam = (teamId: string, reason: string, points: number) => {
    if (points === 0) return;
    const list = teamBreakdown.get(teamId) ?? [];
    list.push({ reason, points });
    teamBreakdown.set(teamId, list);
  };

  for (const p of players) {
    addTeam(p.teamId, `player_${p.userId}_sum`, p.total);
  }

  if (includeResultBonuses) {
    for (const teamId of [fromId, toId]) {
      const bonus = teamResultBonus(teamId, winnerTeamId, isDraw);
      if (bonus !== 0) {
        addTeam(teamId, 'team_result', bonus);
      }
    }
  }

  const teams: FootballTeamPointsRow[] = [fromId, toId].map((teamId) => {
    const breakdown = teamBreakdown.get(teamId) ?? [];
    return {
      teamId,
      total: breakdown.reduce((s, b) => s + b.points, 0),
      breakdown,
    };
  });
  teams.sort((a, b) => b.total - a.total);

  return { players, teams };
}

/** Live match preview: event points only, no result bonuses. */
export function computeFootballPlayerPoints(
  events: FootballMatchEvent[],
): Omit<FootballPlayerPointsRow, 'teamId'>[] {
  const stubMatch = {
    fromTeam: new Types.ObjectId(),
    toTeam: new Types.ObjectId(),
    announcedPlayers: [],
  } as unknown as TeamMatchDocument;

  const { players } = computeFootballMatchRankingPoints(
    stubMatch,
    events,
    null,
    false,
    { includeResultBonuses: false },
  );

  return players.map(({ userId, total, breakdown }) => ({
    userId,
    total,
    breakdown,
  }));
}

export function toMatchRankingSnapshot(
  result: FootballMatchRankingPointsResult,
): MatchRankingPointsSnapshot {
  return {
    players: result.players.map((p) => ({
      userId: p.userId,
      teamId: p.teamId,
      points: p.total,
      breakdown: p.breakdown,
    })),
    teams: result.teams.map((t) => ({
      teamId: t.teamId,
      points: t.total,
      breakdown: t.breakdown,
    })),
  };
}
