import { Types } from 'mongoose';
import type {
  MatchRankingPointsSnapshot,
  RankingPointsBreakdownEntry,
} from '../../core/points/ranking-points.types';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import {
  CricketBallEvent,
  CricketOverEventDocument,
  CricketWicketKind,
} from './cricket-over-event.schema';
import {
  CRICKET_PLAYER_RESULT_BONUS,
  CRICKET_POINT_WEIGHTS,
  CRICKET_TEAM_RESULT_BONUS,
} from './cricket-point-weights';

/** Minimal over slice needed for points (bowler at over level). */
export type CricketOverPointsSlice = {
  bowlerUserId: Types.ObjectId;
  ballEvents: CricketBallEvent[];
  innings?: number;
};

export type PointsBreakdownEntry = RankingPointsBreakdownEntry;

export type PlayerPointsRow = {
  userId: string;
  teamId: string;
  total: number;
  breakdown: PointsBreakdownEntry[];
};

export type TeamPointsRow = {
  teamId: string;
  total: number;
  breakdown: PointsBreakdownEntry[];
};

export type CricketMatchRankingPointsResult = {
  players: PlayerPointsRow[];
  teams: TeamPointsRow[];
};

export type ComputeCricketRankingOptions = {
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
  inningsTeamByUser: Map<string, string>,
): string {
  const fromAnnounced = teamFromAnnounced(match, userId);
  if (fromAnnounced) {
    return fromAnnounced;
  }
  const fromBall = inningsTeamByUser.get(userId);
  if (fromBall) {
    return fromBall;
  }
  return match.fromTeam.toString();
}

function playerResultBonus(
  teamId: string,
  winnerTeamId: string | null,
  isDraw: boolean,
): number {
  if (isDraw) {
    return CRICKET_PLAYER_RESULT_BONUS.draw;
  }
  if (!winnerTeamId) {
    return 0;
  }
  return teamId === winnerTeamId
    ? CRICKET_PLAYER_RESULT_BONUS.win
    : CRICKET_PLAYER_RESULT_BONUS.loss;
}

function teamResultBonus(
  teamId: string,
  winnerTeamId: string | null,
  isDraw: boolean,
): number {
  if (isDraw) {
    return CRICKET_TEAM_RESULT_BONUS.draw;
  }
  if (!winnerTeamId) {
    return CRICKET_TEAM_RESULT_BONUS.draw;
  }
  return teamId === winnerTeamId
    ? CRICKET_TEAM_RESULT_BONUS.win
    : CRICKET_TEAM_RESULT_BONUS.loss;
}

export function computeCricketMatchRankingPoints(
  match: TeamMatchDocument,
  overs: CricketOverPointsSlice[] | CricketOverEventDocument[],
  winnerTeamId: string | null,
  isDraw: boolean,
  options: ComputeCricketRankingOptions = {},
): CricketMatchRankingPointsResult {
  const includeResultBonuses = options.includeResultBonuses ?? true;
  const fromId = match.fromTeam.toString();
  const toId = match.toTeam.toString();
  const slices: CricketOverPointsSlice[] = overs.map((o) => ({
    bowlerUserId: o.bowlerUserId,
    ballEvents: o.ballEvents,
    innings: (o as CricketOverEventDocument).innings ?? o.innings,
  }));

  const battingTeamByInnings = new Map<number, string>();
  const cs = match.cricketState;
  if (cs) {
    for (let i = 0; i < cs.inningsSummaries.length; i++) {
      const inn = cs.inningsSummaries[i];
      if (inn?.battingTeamId) {
        battingTeamByInnings.set(i + 1, inn.battingTeamId.toString());
      }
    }
  }

  const byUser = new Map<string, PointsBreakdownEntry[]>();
  const userTeams = new Map<string, string>();
  const inningsTeamByUser = new Map<string, string>();
  const inningsRunsByBatter = new Map<string, Map<number, number>>();
  const dismissedInInnings = new Set<string>();

  const add = (userId: string, reason: string, points: number) => {
    if (points === 0) return;
    const list = byUser.get(userId) ?? [];
    list.push({ reason, points });
    byUser.set(userId, list);
  };

  const trackInningsRuns = (
    batterId: string,
    innings: number,
    runs: number,
  ) => {
    let byInn = inningsRunsByBatter.get(batterId);
    if (!byInn) {
      byInn = new Map();
      inningsRunsByBatter.set(batterId, byInn);
    }
    byInn.set(innings, (byInn.get(innings) ?? 0) + runs);
  };

  for (const over of slices) {
    const bowler = uid(over.bowlerUserId);
    const innings = over.innings ?? 1;
    const battingTeamId =
      battingTeamByInnings.get(innings) ?? fromId;
    const bowlingTeamId = battingTeamId === fromId ? toId : fromId;

    for (const e of over.ballEvents) {
      const striker = uid(e.strikerUserId);
      const nonStriker = uid(e.nonStrikerUserId);

      inningsTeamByUser.set(striker, battingTeamId);
      inningsTeamByUser.set(nonStriker, battingTeamId);
      inningsTeamByUser.set(bowler, bowlingTeamId);

      userTeams.set(striker, battingTeamId);
      userTeams.set(nonStriker, battingTeamId);
      userTeams.set(bowler, bowlingTeamId);

      if (e.runsOffBat > 0) {
        add(
          striker,
          'runs_off_bat',
          e.runsOffBat * CRICKET_POINT_WEIGHTS.battingRun,
        );
        trackInningsRuns(striker, innings, e.runsOffBat);
      }

      if (e.isLegalDelivery && e.runsOffBat === 0 && !e.isWicket) {
        const extras = e.extrasBye + e.extrasLegBye;
        if (extras === 0 && e.extrasWide === 0) {
          add(bowler, 'dot_ball', CRICKET_POINT_WEIGHTS.bowlingDot);
        }
      }

      if (e.extrasWide > 0) {
        add(bowler, 'wide', CRICKET_POINT_WEIGHTS.wideBowled);
      }
      if (e.extrasNoBall) {
        add(bowler, 'no_ball', CRICKET_POINT_WEIGHTS.noBallBowled);
      }

      if (e.totalRunsOnDelivery > 0) {
        add(
          bowler,
          'runs_conceded',
          e.totalRunsOnDelivery * CRICKET_POINT_WEIGHTS.runsConcededPerRun,
        );
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

        if (e.dismissedUserId) {
          const outId = uid(e.dismissedUserId);
          const outTeam = resolvePlayerTeam(match, outId, inningsTeamByUser);
          userTeams.set(outId, outTeam);
          inningsTeamByUser.set(outId, outTeam);

          const duckKey = `${innings}:${outId}`;
          if (!dismissedInInnings.has(duckKey)) {
            dismissedInInnings.add(duckKey);
            const innRuns = inningsRunsByBatter.get(outId)?.get(innings) ?? 0;
            if (innRuns === 0) {
              add(outId, 'duck', CRICKET_POINT_WEIGHTS.duck);
            }
            add(outId, 'dismissed', CRICKET_POINT_WEIGHTS.dismissed);
          }
        }
      }
    }
  }

  if (includeResultBonuses) {
    for (const userId of byUser.keys()) {
      const teamId =
        userTeams.get(userId) ??
        resolvePlayerTeam(match, userId, inningsTeamByUser);
      userTeams.set(userId, teamId);
      const bonus = playerResultBonus(teamId, winnerTeamId, isDraw);
      if (bonus !== 0) {
        add(userId, 'match_result', bonus);
      }
    }
  }

  const players: PlayerPointsRow[] = [];
  for (const [userId, breakdown] of byUser) {
    const teamId =
      userTeams.get(userId) ??
      resolvePlayerTeam(match, userId, inningsTeamByUser);
    players.push({
      userId,
      teamId,
      total: breakdown.reduce((s, b) => s + b.points, 0),
      breakdown,
    });
  }
  players.sort((a, b) => b.total - a.total);

  const teamBreakdown = new Map<string, PointsBreakdownEntry[]>();
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

  const teams: TeamPointsRow[] = [fromId, toId].map((teamId) => {
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
export function computeCricketPlayerPoints(
  overs: CricketOverPointsSlice[],
): Omit<PlayerPointsRow, 'teamId'>[] {
  const stubMatch = {
    fromTeam: new Types.ObjectId(),
    toTeam: new Types.ObjectId(),
    announcedPlayers: [],
  } as unknown as TeamMatchDocument;

  const { players } = computeCricketMatchRankingPoints(
    stubMatch,
    overs,
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
  result: CricketMatchRankingPointsResult,
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
