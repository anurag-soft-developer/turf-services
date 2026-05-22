export const FOOTBALL_POINT_WEIGHTS = {
  goal: 10,
  assist: 6,
  ownGoalConceded: -2,
  yellowCard: -2,
  redCard: -4,
  penaltyScored: 8,
  penaltyMissed: -2,
} as const;

export const FOOTBALL_PLAYER_RESULT_BONUS = {
  win: 15,
  loss: -5,
  draw: 3,
} as const;

export const FOOTBALL_TEAM_RESULT_BONUS = {
  win: 25,
  loss: -10,
  draw: 5,
} as const;
