import { Types } from 'mongoose';
import { resolveId } from '../../../core/utils/mongo-ref.util';
import type {
  CricketBattingStats,
  CricketBowlingStats,
  CricketFieldingStats,
  CricketPlayerStats,
} from '../../../core/sports/sport-stats';
import {
  CricketState,
  TeamMatchDocument,
} from '../../../matchmaking/schemas/team-match.schema';
import type { CricketStats } from '../../../team/schemas/team.schema';
import {
  CricketBallEvent,
  CricketOverEventDocument,
  CricketWicketKind,
} from '../cricket-over-event.schema';
import {
  emptyCricketBattingStats,
  emptyCricketBowlingStats,
  emptyCricketFieldingStats,
  emptyCricketPlayerStats,
  emptyTeamCricketStats,
} from './cricket-stats.defaults';

type MutableBatting = CricketBattingStats;
type MutableBowling = CricketBowlingStats;
type MutableFielding = CricketFieldingStats;

export type CricketPlayerMatchContribution = {
  userId: string;
  teamId: string;
  stats: CricketPlayerStats;
};

export type CricketTeamMatchContribution = {
  teamId: string;
  sportStats: CricketStats;
  won: boolean;
};

export type CricketMatchStatsSnapshot = {
  players: CricketPlayerMatchContribution[];
  teams: CricketTeamMatchContribution[];
};

type PlayerAccum = {
  teamId: string;
  batting: MutableBatting;
  bowling: MutableBowling;
  fielding: MutableFielding;
  matchesPlayed: number;
  matchesWon: number;
  inningsRuns: Map<number, number>;
  battedInnings: Set<number>;
  bowlerWicketsThisMatch: number;
};

function extrasOnDelivery(ball: CricketBallEvent): number {
  return (
    ball.extrasWide +
    (ball.extrasNoBall ? 1 : 0) +
    ball.extrasBye +
    ball.extrasLegBye
  );
}

function recalcBattingDerived(b: MutableBatting): void {
  b.average = b.timesOut > 0 ? b.runsScored / b.timesOut : 0;
  b.strikeRate = b.ballsFaced > 0 ? (b.runsScored / b.ballsFaced) * 100 : 0;
}

function totalBowlingBalls(b: MutableBowling): number {
  return b.oversBowled * 6 + b.ballsInCurrentOver;
}

function setBowlingBalls(b: MutableBowling, total: number): void {
  b.oversBowled = Math.floor(total / 6);
  b.ballsInCurrentOver = total % 6;
}

function recalcBowlingDerived(b: MutableBowling): void {
  const overs = totalBowlingBalls(b) / 6;
  b.average = b.wicketsTaken > 0 ? b.runsConceded / b.wicketsTaken : 0;
  b.economy = overs > 0 ? b.runsConceded / overs : 0;
  b.strikeRate =
    b.wicketsTaken > 0 ? totalBowlingBalls(b) / b.wicketsTaken : 0;
}

function finalizeInningsBatting(
  acc: PlayerAccum,
  innings: number,
): void {
  const runs = acc.inningsRuns.get(innings) ?? 0;
  if (!acc.battedInnings.has(innings)) {
    return;
  }
  if (runs > acc.batting.highestScore) {
    acc.batting.highestScore = runs;
  }
  if (runs >= 100) {
    acc.batting.hundreds += 1;
  } else if (runs >= 50) {
    acc.batting.fifties += 1;
  }
}

function trackConsecutiveBoundaries(
  acc: PlayerAccum,
  strikerId: string,
  runsOffBat: number,
  streakSixes: Map<string, number>,
  streakFours: Map<string, number>,
): void {
  if (runsOffBat === 6) {
    const n = (streakSixes.get(strikerId) ?? 0) + 1;
    streakSixes.set(strikerId, n);
    streakFours.set(strikerId, 0);
    if (n >= 3) {
      acc.batting.hatTrickSixes += 1;
      streakSixes.set(strikerId, 0);
    }
  } else if (runsOffBat === 4) {
    const n = (streakFours.get(strikerId) ?? 0) + 1;
    streakFours.set(strikerId, n);
    streakSixes.set(strikerId, 0);
    if (n >= 3) {
      acc.batting.hatTrickFours += 1;
      streakFours.set(strikerId, 0);
    }
  } else if (runsOffBat > 0) {
    streakSixes.set(strikerId, 0);
    streakFours.set(strikerId, 0);
  }
}

function teamFromAnnounced(
  match: TeamMatchDocument,
  userId: string,
): string | undefined {
  for (const p of match.announcedPlayers ?? []) {
    if (resolveId(p.userId) === resolveId(userId)) {
      return resolveId(p.teamId);
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
  return resolveId(match.fromTeam);
}

export function aggregateCricketMatchStats(
  match: TeamMatchDocument,
  overs: CricketOverEventDocument[],
  winnerTeamId: string | null,
): CricketMatchStatsSnapshot {
  const cs = match.cricketState as CricketState;
  const fromId = resolveId(match.fromTeam);
  const toId = resolveId(match.toTeam);

  const teamStats = new Map<string, CricketStats>([
    [fromId, emptyTeamCricketStats()],
    [toId, emptyTeamCricketStats()],
  ]);

  const players = new Map<string, PlayerAccum>();
  const inningsTeamByUser = new Map<string, string>();
  const streakSixes = new Map<string, number>();
  const streakFours = new Map<string, number>();
  const bowlerWicketStreak = new Map<string, number>();

  const getPlayer = (userId: string, teamId: string): PlayerAccum => {
    let acc = players.get(userId);
    if (!acc) {
      acc = {
        teamId,
        batting: emptyCricketBattingStats(),
        bowling: emptyCricketBowlingStats(),
        fielding: emptyCricketFieldingStats(),
        matchesPlayed: 0,
        matchesWon: 0,
        inningsRuns: new Map(),
        battedInnings: new Set(),
        bowlerWicketsThisMatch: 0,
      };
      players.set(userId, acc);
    }
    return acc;
  };

  const battingTeamByInnings = new Map<number, string>();
  for (let i = 0; i < cs.inningsSummaries.length; i++) {
    const inn = cs.inningsSummaries[i];
    if (inn?.battingTeamId) {
      battingTeamByInnings.set(i + 1, resolveId(inn.battingTeamId));
    }
  }

  for (const over of overs) {
    const inn = over.innings;
    const battingTeamId =
      battingTeamByInnings.get(inn) ?? resolveId(cs.battingTeamId);
    const bowlingTeamId =
      battingTeamId === fromId ? toId : fromId;

    const bowlerId = resolveId(over.bowlerUserId);
    inningsTeamByUser.set(bowlerId, bowlingTeamId);
    const bowlerAcc = getPlayer(bowlerId, bowlingTeamId);

    let legalInOver = 0;
    let runsInOver = 0;

    for (const ball of over.ballEvents) {
      const strikerId = resolveId(ball.strikerUserId);
      const nonStrikerId = resolveId(ball.nonStrikerUserId);
      inningsTeamByUser.set(strikerId, battingTeamId);
      inningsTeamByUser.set(nonStrikerId, battingTeamId);

      const strikerAcc = getPlayer(strikerId, battingTeamId);
      strikerAcc.battedInnings.add(inn);
      const innRuns =
        (strikerAcc.inningsRuns.get(inn) ?? 0) + ball.runsOffBat;
      strikerAcc.inningsRuns.set(inn, innRuns);

      strikerAcc.batting.runsScored += ball.runsOffBat;
      if (ball.isLegalDelivery) {
        strikerAcc.batting.ballsFaced += 1;
      }
      if (ball.runsOffBat === 4) {
        strikerAcc.batting.fours += 1;
      }
      if (ball.runsOffBat === 6) {
        strikerAcc.batting.sixes += 1;
      }
      trackConsecutiveBoundaries(
        strikerAcc,
        strikerId,
        ball.runsOffBat,
        streakSixes,
        streakFours,
      );

      const bowlExtras = extrasOnDelivery(ball);
      bowlerAcc.bowling.runsConceded += ball.totalRunsOnDelivery;
      if (ball.isLegalDelivery) {
        const totalBalls = totalBowlingBalls(bowlerAcc.bowling) + 1;
        setBowlingBalls(bowlerAcc.bowling, totalBalls);
        legalInOver += 1;
      }
      if (ball.extrasWide > 0) {
        bowlerAcc.bowling.wides += 1;
      }
      if (ball.extrasNoBall) {
        bowlerAcc.bowling.noBalls += 1;
      }

      const bowlingTeamStats = teamStats.get(bowlingTeamId)!;
      bowlingTeamStats.totalExtras += bowlExtras;

      if (
        ball.isWicket &&
        ball.wicketsFallen > 0 &&
        ball.wicketKind !== CricketWicketKind.RUN_OUT
      ) {
        bowlerAcc.bowling.wicketsTaken += ball.wicketsFallen;
        bowlerAcc.bowlerWicketsThisMatch += ball.wicketsFallen;
        bowlingTeamStats.totalWicketsTaken += ball.wicketsFallen;

        const streak = (bowlerWicketStreak.get(bowlerId) ?? 0) + 1;
        bowlerWicketStreak.set(bowlerId, streak);
        if (streak >= 3) {
          bowlerAcc.bowling.hatTricks += 1;
          bowlerWicketStreak.set(bowlerId, 0);
        }

        if (
          ball.wicketKind === CricketWicketKind.CAUGHT &&
          ball.primaryFielderUserId
        ) {
          const fid = resolveId(ball.primaryFielderUserId);
          inningsTeamByUser.set(fid, bowlingTeamId);
          getPlayer(fid, bowlingTeamId).fielding.catches += 1;
        } else if (
          ball.wicketKind === CricketWicketKind.STUMPED &&
          ball.primaryFielderUserId
        ) {
          const fid = resolveId(ball.primaryFielderUserId);
          inningsTeamByUser.set(fid, bowlingTeamId);
          getPlayer(fid, bowlingTeamId).fielding.stumpings += 1;
        }
      } else if (ball.isWicket) {
        bowlerWicketStreak.set(bowlerId, 0);
      } else {
        bowlerWicketStreak.set(bowlerId, 0);
      }

      if (
        ball.isWicket &&
        ball.wicketsFallen > 0 &&
        ball.wicketKind === CricketWicketKind.RUN_OUT &&
        ball.primaryFielderUserId
      ) {
        const fid = resolveId(ball.primaryFielderUserId);
        inningsTeamByUser.set(fid, bowlingTeamId);
        getPlayer(fid, bowlingTeamId).fielding.runOuts += 1;
      }

      if (ball.isWicket && ball.dismissedUserId && ball.wicketsFallen > 0) {
        const outId = resolveId(ball.dismissedUserId);
        const outTeam = resolvePlayerTeam(match, outId, inningsTeamByUser);
        inningsTeamByUser.set(outId, outTeam);
        const outAcc = getPlayer(outId, outTeam);
        outAcc.battedInnings.add(inn);
        outAcc.batting.timesOut += 1;
        const outInnRuns = outAcc.inningsRuns.get(inn) ?? 0;
        if (outInnRuns === 0) {
          outAcc.batting.ducks += 1;
        }
      }

      runsInOver += ball.totalRunsOnDelivery;
    }

    if (legalInOver === 6 && runsInOver === 0) {
      bowlerAcc.bowling.maidenOvers += 1;
    }
  }

  for (const [, acc] of players) {
    if (acc.bowlerWicketsThisMatch >= 5) {
      acc.bowling.fiveWicketHauls += 1;
    }
    if (acc.battedInnings.size > 0) {
      acc.batting.innings += acc.battedInnings.size;
    }
    for (const inn of acc.battedInnings) {
      finalizeInningsBatting(acc, inn);
    }
    recalcBattingDerived(acc.batting);
    recalcBowlingDerived(acc.bowling);

    const matchWickets = acc.bowling.wicketsTaken;
    const matchRuns = acc.bowling.runsConceded;
    if (
      matchWickets > 0 &&
      (matchWickets > acc.bowling.bestFiguresWickets ||
        (matchWickets === acc.bowling.bestFiguresWickets &&
          matchRuns < acc.bowling.bestFiguresRuns))
    ) {
      acc.bowling.bestFiguresWickets = matchWickets;
      acc.bowling.bestFiguresRuns = matchRuns;
    }
  }

  for (let i = 0; i < cs.inningsSummaries.length; i++) {
    const inn = cs.inningsSummaries[i];
    if (!inn?.battingTeamId) {
      continue;
    }
    const batId = resolveId(inn.battingTeamId);
    const bowlId = batId === fromId ? toId : fromId;
    const batStats = teamStats.get(batId)!;
    const bowlStats = teamStats.get(bowlId)!;

    batStats.totalRunsScored += inn.runs;
    bowlStats.totalRunsConceded += inn.runs;

    batStats.highestTeamScore = Math.max(batStats.highestTeamScore, inn.runs);
    if (batStats.lowestTeamScore === 0) {
      batStats.lowestTeamScore = inn.runs;
    } else {
      batStats.lowestTeamScore = Math.min(batStats.lowestTeamScore, inn.runs);
    }

    if (inn.wickets >= 10) {
      batStats.timesAllOut += 1;
    }
  }

  const participated = new Set(players.keys());
  for (const userId of participated) {
    const acc = players.get(userId)!;
    acc.matchesPlayed = 1;
    if (winnerTeamId && acc.teamId === winnerTeamId) {
      acc.matchesWon = 1;
    }
    recalcBattingDerived(acc.batting);
    recalcBowlingDerived(acc.bowling);
  }

  const teams: CricketTeamMatchContribution[] = [
    {
      teamId: fromId,
      sportStats: teamStats.get(fromId)!,
      won: winnerTeamId === fromId,
    },
    {
      teamId: toId,
      sportStats: teamStats.get(toId)!,
      won: winnerTeamId === toId,
    },
  ];

  const playerRows: CricketPlayerMatchContribution[] = [];
  for (const [userId, acc] of players) {
    playerRows.push({
      userId,
      teamId: acc.teamId,
      stats: {
        matchesPlayed: acc.matchesPlayed,
        matchesWon: acc.matchesWon,
        batting: { ...acc.batting },
        bowling: { ...acc.bowling },
        fielding: { ...acc.fielding },
      },
    });
  }

  return { players: playerRows, teams };
}
