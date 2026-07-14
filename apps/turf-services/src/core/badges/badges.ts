/**
 * Core badge system — sport-agnostic definitions and evaluation logic.
 * Intentionally has no imports from feature modules to avoid circular deps.
 * The evaluateBadges() function is unused until the match/scoring feature is built.
 */

import { SportType } from '../../team/schemas/team.schema';

type SportTypeString = `${SportType}` | 'all';

export interface EarnedBadge {
  /** References BadgeDefinition.id */
  badgeId: string;
  earnedAt: Date;
  /**
   * The sport in which this badge was earned (SportType value string).
   * Always set for player badges; optional for team badges since sport
   * is already on the team document.
   */
  sportType?: SportTypeString;
}

type BadgeOperator = '>=' | '>' | '==';

interface BadgeCriteria {
  /** Key inside sportStats or common stats (wins, matchesPlayed, …). */
  statKey: string;
  operator: BadgeOperator;
  threshold: number;
}

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  /**
   * SportType value string (e.g. 'football', 'cricket') or 'all' for
   * sport-agnostic badges evaluated against common stats (wins, matchesPlayed…).
   */
  sportType: SportTypeString;
  criteria: BadgeCriteria;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  // --- Universal ---
  {
    id: 'first_win',
    name: 'First Blood',
    description: 'Won your first match',
    sportType: 'all',
    criteria: { statKey: 'wins', operator: '>=', threshold: 1 },
  },
  {
    id: 'ten_wins',
    name: 'On a Roll',
    description: 'Won 10 matches',
    sportType: 'all',
    criteria: { statKey: 'wins', operator: '>=', threshold: 10 },
  },
  {
    id: 'fifty_wins',
    name: 'Dynasty',
    description: 'Won 50 matches',
    sportType: 'all',
    criteria: { statKey: 'wins', operator: '>=', threshold: 50 },
  },

  // --- Football ---
  {
    id: 'fb_clean_sheet_5',
    name: 'Iron Wall',
    description: '5 clean sheets',
    sportType: 'football',
    criteria: { statKey: 'cleanSheets', operator: '>=', threshold: 5 },
  },
  {
    id: 'fb_clean_sheet_20',
    name: 'Fortress',
    description: '20 clean sheets',
    sportType: 'football',
    criteria: { statKey: 'cleanSheets', operator: '>=', threshold: 20 },
  },
  {
    id: 'fb_goals_50',
    name: 'Goal Machine',
    description: 'Scored 50 goals',
    sportType: 'football',
    criteria: { statKey: 'goalsScored', operator: '>=', threshold: 50 },
  },
  {
    id: 'fb_goals_200',
    name: 'Attack Force',
    description: 'Scored 200 goals',
    sportType: 'football',
    criteria: { statKey: 'goalsScored', operator: '>=', threshold: 200 },
  },

  // --- Cricket ---
  {
    id: 'cr_runs_500',
    name: 'Run Feast',
    description: 'Scored 500 total runs',
    sportType: 'cricket',
    criteria: { statKey: 'totalRunsScored', operator: '>=', threshold: 500 },
  },
  {
    id: 'cr_runs_5000',
    name: 'Run Machine',
    description: 'Scored 5000 total runs',
    sportType: 'cricket',
    criteria: { statKey: 'totalRunsScored', operator: '>=', threshold: 5000 },
  },
  {
    id: 'cr_wickets_50',
    name: 'Wicket Hunters',
    description: 'Taken 50 wickets',
    sportType: 'cricket',
    criteria: { statKey: 'totalWicketsTaken', operator: '>=', threshold: 50 },
  },
  {
    id: 'cr_wickets_200',
    name: 'Bowling Attack',
    description: 'Taken 200 wickets',
    sportType: 'cricket',
    criteria: { statKey: 'totalWicketsTaken', operator: '>=', threshold: 200 },
  },
];

/**
 * Evaluates which badges a team has newly unlocked and returns them.
 * Call this after updating match stats, then append the result to team.badges.
 *
 * NOTE: intentionally unused until the match/scoring feature is built.
 */
export function evaluateBadges(team: {
  sportType: SportType;
  wins: number;
  losses: number;
  draws: number;
  matchesPlayed: number;
  sportStats: Record<string, Record<string, number> | undefined>;
  badges: EarnedBadge[];
}): EarnedBadge[] {
  const earnedIds = new Set(team.badges.map((b) => b.badgeId));
  const newBadges: EarnedBadge[] = [];

  const sportStats = team.sportStats[team.sportType] ?? {};
  const commonStats: Record<string, number> = {
    wins: team.wins,
    losses: team.losses,
    draws: team.draws,
    matchesPlayed: team.matchesPlayed,
  };
  const allStats: Record<string, number> = { ...commonStats, ...sportStats };

  for (const badge of BADGE_DEFINITIONS) {
    if (earnedIds.has(badge.id)) continue;
    if (badge.sportType !== 'all' && badge.sportType !== team.sportType)
      continue;

    const value = allStats[badge.criteria.statKey] ?? 0;
    const { operator, threshold } = badge.criteria;
    const unlocked =
      operator === '>='
        ? value >= threshold
        : operator === '>'
          ? value > threshold
          : value === threshold;

    if (unlocked) {
      newBadges.push({
        badgeId: badge.id,
        earnedAt: new Date(),
        sportType: badge.sportType === 'all' ? team.sportType : badge.sportType,
      });
    }
  }

  return newBadges;
}
