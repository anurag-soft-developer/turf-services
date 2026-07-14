/** Tunable ranking weights for cricket (positive and negative). */
export const CRICKET_POINT_WEIGHTS = {
  battingRun: 1,
  bowlingDot: 1,
  bowlingWicket: 10,
  fieldingCatch: 8,
  fieldingRunOutThrow: 6,
  fieldingStumping: 6,
  duck: -5,
  wideBowled: -1,
  noBallBowled: -1,
  dismissed: -2,
  runsConcededPerRun: -1,
} as const;

export const CRICKET_PLAYER_RESULT_BONUS = {
  win: 15,
  loss: -5,
  draw: 3,
} as const;

export const CRICKET_TEAM_RESULT_BONUS = {
  win: 25,
  loss: -10,
  draw: 5,
} as const;
