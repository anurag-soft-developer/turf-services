import type { FootballPlayerStats } from '../../../core/sports/sport-stats';
import type { FootballStats } from '../../../team/schemas/team.schema';

export function emptyFootballPlayerStats(): FootballPlayerStats {
  return {
    matchesPlayed: 0,
    matchesWon: 0,
    goalsScored: 0,
    assists: 0,
    cleanSheets: 0,
    saves: 0,
    yellowCards: 0,
    redCards: 0,
    hatTricks: 0,
    shotsOnTarget: 0,
    penaltiesScored: 0,
    penaltiesMissed: 0,
    ownGoals: 0,
  };
}

export function emptyTeamFootballStats(): FootballStats {
  return {
    goalsScored: 0,
    goalsConceded: 0,
    penaltyGoalsScored: 0,
    penaltiesMissed: 0,
    cleanSheets: 0,
    yellowCards: 0,
    redCards: 0,
  };
}
