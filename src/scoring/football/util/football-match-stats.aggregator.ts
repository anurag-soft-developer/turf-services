import { Types } from 'mongoose';
import type { FootballPlayerStats } from '../../../core/sports/sport-stats';
import { TeamMatchDocument } from '../../../matchmaking/schemas/team-match.schema';
import type { FootballStats } from '../../../team/schemas/team.schema';
import {
  FootballEventKind,
  FootballMatchEvent,
} from '../football-match-event.schema';
import {
  emptyFootballPlayerStats,
  emptyTeamFootballStats,
} from './football-stats.defaults';

export type FootballPlayerMatchContribution = {
  userId: string;
  teamId: string;
  stats: FootballPlayerStats;
};

export type FootballTeamMatchContribution = {
  teamId: string;
  sportStats: FootballStats;
  won: boolean;
};

export type FootballMatchStatsSnapshot = {
  players: FootballPlayerMatchContribution[];
  teams: FootballTeamMatchContribution[];
};

type PlayerAccum = FootballPlayerStats & {
  teamId: string;
  goalsThisMatch: number;
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

function ensurePlayer(
  players: Map<string, PlayerAccum>,
  userId: string,
  teamId: string,
): PlayerAccum {
  let acc = players.get(userId);
  if (!acc) {
    acc = {
      ...emptyFootballPlayerStats(),
      teamId,
      goalsThisMatch: 0,
    };
    players.set(userId, acc);
  }
  return acc;
}

export function aggregateFootballMatchStats(
  match: TeamMatchDocument,
  events: FootballMatchEvent[],
  winnerTeamId: string | null,
  isDraw: boolean,
): FootballMatchStatsSnapshot {
  const fromId = match.fromTeam.toString();
  const toId = match.toTeam.toString();
  const fs = match.footballState!;
  const scoreOne = fs.scoreTeamOne;
  const scoreTwo = fs.scoreTeamTwo;

  const teamStats = new Map<string, FootballStats>([
    [fromId, emptyTeamFootballStats()],
    [toId, emptyTeamFootballStats()],
  ]);

  const fromStats = teamStats.get(fromId)!;
  const toStats = teamStats.get(toId)!;
  fromStats.goalsScored = scoreOne;
  fromStats.goalsConceded = scoreTwo;
  toStats.goalsScored = scoreTwo;
  toStats.goalsConceded = scoreOne;
  if (scoreTwo === 0) {
    fromStats.cleanSheets = 1;
  }
  if (scoreOne === 0) {
    toStats.cleanSheets = 1;
  }

  const players = new Map<string, PlayerAccum>();
  const eventTeamByUser = new Map<string, string>();

  for (const e of events) {
    const benTeam = uid(e.beneficiaryTeamId);
    if (e.primaryUserId) {
      const primary = uid(e.primaryUserId);
      eventTeamByUser.set(primary, benTeam);
    }
    if (e.secondaryUserId) {
      const secondary = uid(e.secondaryUserId);
      eventTeamByUser.set(secondary, benTeam);
    }

    switch (e.kind) {
      case FootballEventKind.GOAL: {
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          const acc = ensurePlayer(players, userId, teamId);
          acc.goalsScored += 1;
          acc.goalsThisMatch += 1;
        }
        if (e.secondaryUserId) {
          const userId = uid(e.secondaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          const acc = ensurePlayer(players, userId, teamId);
          acc.assists += 1;
        }
        break;
      }
      case FootballEventKind.OWN_GOAL: {
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const concedingTeam =
            benTeam === fromId ? toId : fromId;
          eventTeamByUser.set(userId, concedingTeam);
          const acc = ensurePlayer(players, userId, concedingTeam);
          acc.ownGoals += 1;
        }
        break;
      }
      case FootballEventKind.YELLOW_CARD: {
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          const acc = ensurePlayer(players, userId, teamId);
          acc.yellowCards += 1;
          if (teamId === fromId) {
            fromStats.yellowCards += 1;
          } else {
            toStats.yellowCards += 1;
          }
        }
        break;
      }
      case FootballEventKind.RED_CARD: {
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          const acc = ensurePlayer(players, userId, teamId);
          acc.redCards += 1;
          if (teamId === fromId) {
            fromStats.redCards += 1;
          } else {
            toStats.redCards += 1;
          }
        }
        break;
      }
      case FootballEventKind.PENALTY_SCORED: {
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          const acc = ensurePlayer(players, userId, teamId);
          acc.penaltiesScored += 1;
          acc.goalsScored += 1;
          acc.goalsThisMatch += 1;
          if (teamId === fromId) {
            fromStats.penaltyGoalsScored += 1;
          } else {
            toStats.penaltyGoalsScored += 1;
          }
        }
        break;
      }
      case FootballEventKind.PENALTY_MISSED: {
        if (e.primaryUserId) {
          const userId = uid(e.primaryUserId);
          const teamId = resolvePlayerTeam(match, userId, eventTeamByUser);
          const acc = ensurePlayer(players, userId, teamId);
          acc.penaltiesMissed += 1;
          if (teamId === fromId) {
            fromStats.penaltiesMissed += 1;
          } else {
            toStats.penaltiesMissed += 1;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  for (const acc of players.values()) {
    acc.matchesPlayed = 1;
    if (!isDraw && winnerTeamId && acc.teamId === winnerTeamId) {
      acc.matchesWon = 1;
    }
    if (acc.goalsThisMatch >= 3) {
      acc.hatTricks = 1;
    }
  }

  const playerRows: FootballPlayerMatchContribution[] = [];
  for (const [userId, acc] of players) {
    const { goalsThisMatch: _, teamId, ...stats } = acc;
    playerRows.push({ userId, teamId, stats });
  }

  const teams: FootballTeamMatchContribution[] = [
    {
      teamId: fromId,
      sportStats: fromStats,
      won: !isDraw && winnerTeamId === fromId,
    },
    {
      teamId: toId,
      sportStats: toStats,
      won: !isDraw && winnerTeamId === toId,
    },
  ];

  return { players: playerRows, teams };
}
