import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  CricketBattingStats,
  CricketBowlingStats,
  CricketFieldingStats,
  CricketPlayerStats,
} from '../../core/sports/sport-stats';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { SportType, Team, TeamDocument } from '../../team/schemas/team.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { CricketOverEventDocument } from './cricket-over-event.schema';
import {
  aggregateCricketMatchStats,
  CricketMatchStatsSnapshot,
} from './util/cricket-match-stats.aggregator';
import {
  emptyCricketPlayerStats,
  emptyTeamCricketStats,
} from './util/cricket-stats.defaults';

@Injectable()
export class CricketMatchStatsService {
  constructor(
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async applyMatchStats(
    match: TeamMatchDocument,
    overs: CricketOverEventDocument[],
    winnerTeamId: string | null,
    isDraw: boolean,
  ): Promise<void> {
    const snapshot = aggregateCricketMatchStats(match, overs, winnerTeamId);
    await Promise.all([
      ...snapshot.teams.map((t) =>
        this.applyTeamContribution(t.teamId, t.sportStats, t.won, isDraw),
      ),
      ...snapshot.players.map((p) => this.applyPlayerContribution(p)),
    ]);
  }

  private async applyTeamContribution(
    teamId: string,
    delta: CricketMatchStatsSnapshot['teams'][0]['sportStats'],
    won: boolean,
    isDraw: boolean,
  ): Promise<void> {
    const team = await this.teamModel.findById(teamId);
    if (!team) {
      return;
    }

    team.matchesPlayed += 1;
    if (isDraw) {
      team.draws += 1;
    } else if (won) {
      team.wins += 1;
    } else {
      team.losses += 1;
    }
    team.winRate = team.matchesPlayed > 0 ? team.wins / team.matchesPlayed : 0;

    const key = SportType.CRICKET;
    const prev = team.sportStats?.[key] ?? emptyTeamCricketStats();
    team.sportStats = {
      ...team.sportStats,
      [key]: {
        totalRunsScored: prev.totalRunsScored + delta.totalRunsScored,
        totalRunsConceded: prev.totalRunsConceded + delta.totalRunsConceded,
        totalWicketsTaken: prev.totalWicketsTaken + delta.totalWicketsTaken,
        highestTeamScore: Math.max(
          prev.highestTeamScore,
          delta.highestTeamScore,
        ),
        lowestTeamScore:
          prev.lowestTeamScore === 0
            ? delta.lowestTeamScore
            : delta.lowestTeamScore === 0
              ? prev.lowestTeamScore
              : Math.min(prev.lowestTeamScore, delta.lowestTeamScore),
        totalExtras: prev.totalExtras + delta.totalExtras,
        timesAllOut: prev.timesAllOut + delta.timesAllOut,
      },
    };
    team.markModified('sportStats');
    await team.save();
  }

  private async applyPlayerContribution(
    row: CricketMatchStatsSnapshot['players'][0],
  ): Promise<void> {
    const user = await this.userModel.findById(row.userId);
    if (!user) {
      return;
    }

    const sportType = SportType.CRICKET;
    if (!user.playerSportStats) {
      user.playerSportStats = [];
    }
    let entry = user.playerSportStats.find((e) => e.sportType === sportType);
    if (!entry) {
      entry = { sportType, stats: emptyCricketPlayerStats() };
      user.playerSportStats.push(entry);
    }

    const prev = entry.stats as CricketPlayerStats;
    entry.stats = {
      matchesPlayed: prev.matchesPlayed + row.stats.matchesPlayed,
      matchesWon: prev.matchesWon + row.stats.matchesWon,
      batting: mergeBatting(prev.batting, row.stats.batting),
      bowling: mergeBowling(prev.bowling, row.stats.bowling),
      fielding: mergeFielding(prev.fielding, row.stats.fielding),
    };
    user.markModified('playerSportStats');
    await user.save();
  }
}

function mergeBatting(
  prev: CricketBattingStats,
  delta: CricketBattingStats,
): CricketBattingStats {
  const merged: CricketBattingStats = {
    innings: prev.innings + delta.innings,
    timesOut: prev.timesOut + delta.timesOut,
    runsScored: prev.runsScored + delta.runsScored,
    ballsFaced: prev.ballsFaced + delta.ballsFaced,
    highestScore: Math.max(prev.highestScore, delta.highestScore),
    average: 0,
    strikeRate: 0,
    fours: prev.fours + delta.fours,
    sixes: prev.sixes + delta.sixes,
    ducks: prev.ducks + delta.ducks,
    fifties: prev.fifties + delta.fifties,
    hundreds: prev.hundreds + delta.hundreds,
    hatTrickSixes: prev.hatTrickSixes + delta.hatTrickSixes,
    hatTrickFours: prev.hatTrickFours + delta.hatTrickFours,
  };
  merged.average =
    merged.timesOut > 0 ? merged.runsScored / merged.timesOut : 0;
  merged.strikeRate =
    merged.ballsFaced > 0 ? (merged.runsScored / merged.ballsFaced) * 100 : 0;
  return merged;
}

function mergeBowling(
  prev: CricketBowlingStats,
  delta: CricketBowlingStats,
): CricketBowlingStats {
  const prevBalls = prev.oversBowled * 6 + prev.ballsInCurrentOver;
  const deltaBalls = delta.oversBowled * 6 + delta.ballsInCurrentOver;
  const totalBalls = prevBalls + deltaBalls;
  const oversBowled = Math.floor(totalBalls / 6);
  const ballsInCurrentOver = totalBalls % 6;
  const wicketsTaken = prev.wicketsTaken + delta.wicketsTaken;
  const runsConceded = prev.runsConceded + delta.runsConceded;
  const oversDecimal = totalBalls / 6;

  let bestFiguresWickets = prev.bestFiguresWickets;
  let bestFiguresRuns = prev.bestFiguresRuns;
  if (
    delta.wicketsTaken > 0 &&
    (delta.wicketsTaken > bestFiguresWickets ||
      (delta.wicketsTaken === bestFiguresWickets &&
        delta.runsConceded < bestFiguresRuns))
  ) {
    bestFiguresWickets = delta.wicketsTaken;
    bestFiguresRuns = delta.runsConceded;
  }

  return {
    oversBowled,
    ballsInCurrentOver,
    maidenOvers: prev.maidenOvers + delta.maidenOvers,
    wicketsTaken,
    runsConceded,
    bestFiguresWickets,
    bestFiguresRuns,
    average: wicketsTaken > 0 ? runsConceded / wicketsTaken : 0,
    economy: oversDecimal > 0 ? runsConceded / oversDecimal : 0,
    strikeRate: wicketsTaken > 0 ? totalBalls / wicketsTaken : 0,
    hatTricks: prev.hatTricks + delta.hatTricks,
    fiveWicketHauls: prev.fiveWicketHauls + delta.fiveWicketHauls,
    wides: prev.wides + delta.wides,
    noBalls: prev.noBalls + delta.noBalls,
  };
}

function mergeFielding(
  prev: CricketFieldingStats,
  delta: CricketFieldingStats,
): CricketFieldingStats {
  return {
    catches: prev.catches + delta.catches,
    runOuts: prev.runOuts + delta.runOuts,
    stumpings: prev.stumpings + delta.stumpings,
  };
}
