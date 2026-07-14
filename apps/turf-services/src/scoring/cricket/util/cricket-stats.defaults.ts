import type {
  CricketBattingStats,
  CricketBowlingStats,
  CricketFieldingStats,
  CricketPlayerStats,
} from '../../../core/sports/sport-stats';
import type { CricketStats } from '../../../team/schemas/team.schema';

export function emptyCricketBattingStats(): CricketBattingStats {
  return {
    innings: 0,
    timesOut: 0,
    runsScored: 0,
    ballsFaced: 0,
    highestScore: 0,
    average: 0,
    strikeRate: 0,
    fours: 0,
    sixes: 0,
    ducks: 0,
    fifties: 0,
    hundreds: 0,
    hatTrickSixes: 0,
    hatTrickFours: 0,
  };
}

export function emptyCricketBowlingStats(): CricketBowlingStats {
  return {
    oversBowled: 0,
    ballsInCurrentOver: 0,
    maidenOvers: 0,
    wicketsTaken: 0,
    runsConceded: 0,
    bestFiguresWickets: 0,
    bestFiguresRuns: 0,
    average: 0,
    economy: 0,
    strikeRate: 0,
    hatTricks: 0,
    fiveWicketHauls: 0,
    wides: 0,
    noBalls: 0,
  };
}

export function emptyCricketFieldingStats(): CricketFieldingStats {
  return {
    catches: 0,
    runOuts: 0,
    stumpings: 0,
  };
}

export function emptyCricketPlayerStats(): CricketPlayerStats {
  return {
    matchesPlayed: 0,
    matchesWon: 0,
    batting: emptyCricketBattingStats(),
    bowling: emptyCricketBowlingStats(),
    fielding: emptyCricketFieldingStats(),
  };
}

export function emptyTeamCricketStats(): CricketStats {
  return {
    totalRunsScored: 0,
    totalRunsConceded: 0,
    totalWicketsTaken: 0,
    highestTeamScore: 0,
    lowestTeamScore: 0,
    totalExtras: 0,
    timesAllOut: 0,
  };
}
