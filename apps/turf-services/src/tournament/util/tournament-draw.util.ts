import {
  TeamMatchDocument,
  TeamMatchStatus,
} from '../../matchmaking/schemas/team-match.schema';
import { TournamentFormat, TournamentStage } from '../tournament.constants';

export type FixturePlan = {
  fromTeamId?: string;
  toTeamId?: string;
  stage: TournamentStage;
  round: number;
  groupLabel?: string;
  matchNumber: number;
  sourceMatchNumbers?: number[];
};

/** Single round-robin. Odd counts get a bye each round. */
export function roundRobinPairs(teamIds: string[]): Array<[string, string]> {
  const list = [...teamIds];
  if (list.length < 2) {
    return [];
  }
  if (list.length % 2 === 1) {
    list.push('');
  }
  const count = list.length;
  const half = count / 2;
  const rotation = [...list];
  const pairs: Array<[string, string]> = [];

  for (let round = 0; round < count - 1; round += 1) {
    for (let index = 0; index < half; index += 1) {
      const home = rotation[index];
      const away = rotation[count - 1 - index];
      if (home && away) {
        pairs.push([home, away]);
      }
    }
    const fixed = rotation[0];
    const rest = rotation.slice(1);
    const moved = rest.pop();
    if (moved !== undefined) {
      rest.unshift(moved);
    }
    rotation.splice(0, rotation.length, fixed, ...rest);
  }

  return pairs;
}

export function chunkTeams(teamIds: string[], size: number): string[][] {
  const groups: string[][] = [];
  for (let index = 0; index < teamIds.length; index += size) {
    groups.push(teamIds.slice(index, index + size));
  }
  return groups;
}

/** 1-indexed seed slot order for a single-elimination first round (e.g. 8 → 1,8,4,5,2,7,3,6). */
export function generateBracketSeedOrder(teamCount: number): number[] {
  if (!Number.isInteger(teamCount) || teamCount < 2 || (teamCount & (teamCount - 1)) !== 0) {
    return [];
  }
  let order = [1, 2];
  while (order.length < teamCount) {
    const next: number[] = [];
    const double = order.length * 2;
    for (const seed of order) {
      next.push(seed);
      next.push(double + 1 - seed);
    }
    order = next;
  }
  return order;
}

/** [best … worst] standings order → first-round knockout pairings in bracket layout. */
export function bracketFirstRoundPairs(
  rankedTeamIds: string[],
): Array<[string, string]> {
  const n = rankedTeamIds.length;
  if (n < 2 || (n & (n - 1)) !== 0) {
    return [];
  }
  const seedOrder = generateBracketSeedOrder(n);
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index < n; index += 2) {
    pairs.push([
      rankedTeamIds[seedOrder[index] - 1],
      rankedTeamIds[seedOrder[index + 1] - 1],
    ]);
  }
  return pairs;
}

export function openingFixturePlans(
  format: TournamentFormat,
  teamIds: string[],
): FixturePlan[] {
  let matchNumber = 1;
  const plans: FixturePlan[] = [];
  const push = (
    pair: [string, string],
    stage: TournamentStage,
    round: number,
    groupLabel?: string,
  ) => {
    plans.push({
      fromTeamId: pair[0],
      toTeamId: pair[1],
      stage,
      round,
      groupLabel,
      matchNumber,
    });
    matchNumber += 1;
  };

  if (format === TournamentFormat.KNOCKOUT) {
    for (let index = 0; index < teamIds.length; index += 2) {
      push(
        [teamIds[index], teamIds[index + 1]],
        TournamentStage.KNOCKOUT,
        1,
      );
    }
    return plans;
  }

  if (
    format === TournamentFormat.LEAGUE ||
    format === TournamentFormat.HYBRID
  ) {
    for (const pair of roundRobinPairs(teamIds)) {
      push(pair, TournamentStage.LEAGUE, 1);
    }
    return plans;
  }

  const groups = chunkTeams(teamIds, 4);
  const labels = ['A', 'B', 'C', 'D'];
  groups.forEach((group, index) => {
    const label = labels[index] ?? String(index + 1);
    for (const pair of roundRobinPairs(group)) {
      push(pair, TournamentStage.GROUP, 1, label);
    }
  });
  return plans;
}

/** Opening pairs plus every later knockout slot through the final. Later sides stay empty. */
export function knockoutFullBracketPlans(teamIds: string[]): FixturePlan[] {
  const plans = openingFixturePlans(TournamentFormat.KNOCKOUT, teamIds);
  let previous = plans.map((plan) => plan.matchNumber);
  let round = 2;
  let matchNumber = plans.length + 1;

  while (previous.length > 1) {
    const next: number[] = [];
    for (let index = 0; index + 1 < previous.length; index += 2) {
      plans.push({
        stage: TournamentStage.KNOCKOUT,
        round,
        matchNumber,
        sourceMatchNumbers: [previous[index], previous[index + 1]],
      });
      next.push(matchNumber);
      matchNumber += 1;
    }
    previous = next;
    round += 1;
  }

  return plans;
}

export type DerivedPlan = {
  fromTeamId: string;
  toTeamId: string;
  round: number;
  sourceMatchNumbers?: number[];
  bracketKey?: string;
};

export function hasResult(match: TeamMatchDocument): boolean {
  return (
    match.status === TeamMatchStatus.COMPLETED ||
    match.status === TeamMatchStatus.DRAW
  );
}

export function isDerivedFixture(match: TeamMatchDocument): boolean {
  return Boolean(match.bracketKey) || (match.sourceMatchNumbers?.length ?? 0) > 0;
}

export function planMatches(match: TeamMatchDocument, plan: DerivedPlan): boolean {
  if (plan.bracketKey) {
    return match.bracketKey === plan.bracketKey;
  }
  const sources = [...(match.sourceMatchNumbers ?? [])].sort(
    (left, right) => left - right,
  );
  const expected = plan.sourceMatchNumbers ?? [];
  return (
    sources.length === expected.length &&
    sources.every((value, index) => value === expected[index])
  );
}
