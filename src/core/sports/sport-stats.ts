/**
 * Individual player career statistics per sport.
 * These are player-level (not team-level) stats accumulated across all teams
 * a player has been part of.
 *
 * Stats are stored as Mixed in MongoDB so adding a new sport never requires
 * a schema migration — just define a new interface and start writing.
 */

// ---------------------------------------------------------------------------
// Football
// ---------------------------------------------------------------------------

export interface FootballPlayerStats {
  matchesPlayed: number;
  matchesWon: number;
  goalsScored: number;
  assists: number;
  /** Matches the player kept a clean sheet (goalkeeper stat). */
  cleanSheets: number;
  /** Goals saved by a goalkeeper. */
  saves: number;
  yellowCards: number;
  redCards: number;
  /** Hat-tricks scored (3+ goals in a single match). */
  hatTricks: number;
  /** Total shots on target. */
  shotsOnTarget: number;
  /** Total penalty kicks converted. */
  penaltiesScored: number;
  /** Total penalty kicks missed or saved against. */
  penaltiesMissed: number;
  /** Own goals scored. */
  ownGoals: number;
}

// ---------------------------------------------------------------------------
// Cricket — Batting
// ---------------------------------------------------------------------------

export interface CricketBattingStats {
  innings: number;
  /** Times dismissed (notOuts = innings - timesOut). */
  timesOut: number;
  runsScored: number;
  ballsFaced: number;
  highestScore: number;
  /** Batting average = runsScored / timesOut. */
  average: number;
  /** Strike rate = (runsScored / ballsFaced) × 100. */
  strikeRate: number;
  fours: number;
  sixes: number;
  /** Innings where the player scored 0 and was dismissed. */
  ducks: number;
  fifties: number;
  hundreds: number;
  /** Hat-trick of sixes: 3 consecutive sixes in a single over. */
  hatTrickSixes: number;
  /** Hat-trick of fours: 3 consecutive fours in a single over. */
  hatTrickFours: number;
}

// ---------------------------------------------------------------------------
// Cricket — Bowling
// ---------------------------------------------------------------------------

export interface CricketBowlingStats {
  /** Total complete overs bowled. */
  oversBowled: number;
  /** Balls bowled within incomplete overs (0–5). */
  ballsInCurrentOver: number;
  /** Maiden overs (overs where 0 runs were conceded). */
  maidenOvers: number;
  wicketsTaken: number;
  runsConceded: number;
  /** Best bowling figures in a single match (e.g. 5 wickets for 23 runs). */
  bestFiguresWickets: number;
  bestFiguresRuns: number;
  /** Bowling average = runsConceded / wicketsTaken. */
  average: number;
  /** Economy rate = runsConceded / oversBowled. */
  economy: number;
  /** Bowling strike rate = balls bowled / wicketsTaken. */
  strikeRate: number;
  /** Hat-tricks taken (3 wickets on 3 consecutive deliveries). */
  hatTricks: number;
  /** 5-wicket hauls in a single innings. */
  fiveWicketHauls: number;
  wides: number;
  noBalls: number;
}

// ---------------------------------------------------------------------------
// Cricket — Fielding
// ---------------------------------------------------------------------------

export interface CricketFieldingStats {
  catches: number;
  runOuts: number;
  /** Stumpings (wicket-keeper stat). */
  stumpings: number;
}

// ---------------------------------------------------------------------------
// Combined cricket player stats
// ---------------------------------------------------------------------------

export interface CricketPlayerStats {
  matchesPlayed: number;
  batting: CricketBattingStats;
  bowling: CricketBowlingStats;
  fielding: CricketFieldingStats;
}

// ---------------------------------------------------------------------------
// Entry type stored in the player's stats array
// ---------------------------------------------------------------------------

/**
 * One entry in a player's career stats array.
 * `sportType` is the SportType enum value string (e.g. 'football', 'cricket').
 * `stats` is Mixed — shape is determined by sportType.
 */
export interface PlayerSportEntry {
  sportType: string;
  stats: FootballPlayerStats | CricketPlayerStats;
}
