import { z } from 'zod';

/**
 * Canonical sport type IDs (lowercase slugs):
 * football, cricket, basketball, badminton, tennis, volleyball, hockey,
 * table_tennis, squash, futsal, kabaddi, pickleball, rugby, baseball,
 * softball, handball, throwball, netball, athletics, boxing, martial_arts,
 * skating, golf, swimming
 */
export enum SportType {
  FOOTBALL = 'football',
  CRICKET = 'cricket',
  BASKETBALL = 'basketball',
  BADMINTON = 'badminton',
  TENNIS = 'tennis',
  VOLLEYBALL = 'volleyball',
  HOCKEY = 'hockey',
  TABLE_TENNIS = 'table_tennis',
  SQUASH = 'squash',
  FUTSAL = 'futsal',
  KABADDI = 'kabaddi',
  PICKLEBALL = 'pickleball',
  RUGBY = 'rugby',
  BASEBALL = 'baseball',
  SOFTBALL = 'softball',
  HANDBALL = 'handball',
  THROWBALL = 'throwball',
  NETBALL = 'netball',
  ATHLETICS = 'athletics',
  BOXING = 'boxing',
  MARTIAL_ARTS = 'martial_arts',
  SKATING = 'skating',
  GOLF = 'golf',
  SWIMMING = 'swimming',
}

export const SPORT_TYPE_VALUES = Object.values(SportType) as [
  SportType,
  ...SportType[],
];

export const RANKING_SPORT_TYPES = [
  SportType.CRICKET,
  SportType.FOOTBALL,
] as const;

export const SCORING_SPORT_TYPES = RANKING_SPORT_TYPES;

export type RankingSportType = (typeof RANKING_SPORT_TYPES)[number];
export type ScoringSportType = (typeof SCORING_SPORT_TYPES)[number];

export const sportTypeSchema = z.enum(SPORT_TYPE_VALUES);
export const rankingSportTypeSchema = z.enum(['cricket', 'football']);
export const scoringSportTypeSchema = rankingSportTypeSchema;

export const DEFAULT_SPORT_ROSTER_BOUNDS = { min: 2, max: 20 } as const;

export const SPORT_ROSTER_CONFIG: Record<
  SportType,
  { min: number; max: number }
> = {
  [SportType.CRICKET]: { min: 5, max: 15 },
  [SportType.FOOTBALL]: { min: 5, max: 18 },
  [SportType.BASKETBALL]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.BADMINTON]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.TENNIS]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.VOLLEYBALL]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.HOCKEY]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.TABLE_TENNIS]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.SQUASH]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.FUTSAL]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.KABADDI]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.PICKLEBALL]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.RUGBY]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.BASEBALL]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.SOFTBALL]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.HANDBALL]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.THROWBALL]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.NETBALL]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.ATHLETICS]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.BOXING]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.MARTIAL_ARTS]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.SKATING]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.GOLF]: DEFAULT_SPORT_ROSTER_BOUNDS,
  [SportType.SWIMMING]: DEFAULT_SPORT_ROSTER_BOUNDS,
};
