import { resolveId, resolveIdOrNull } from '../../core/utils/mongo-ref.util';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { TournamentDocument } from '../schemas/tournament.schema';
import { LEAGUE_WIN_POINTS } from '../tournament.constants';

export type InningsLine = {
  runs: number;
  legalBalls: number;
  battingTeamId?: string;
  bowlingTeamId?: string;
};

export type StandingMatch = {
  fromTeamId: string;
  toTeamId: string;
  status: string;
  winnerTeamId?: string;
  innings: InningsLine[];
};

export type StandingRow = {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  runsScored: number;
  oversFaced: number;
  runsConceded: number;
  oversBowled: number;
  nrr: number;
};

export type AdvanceResolution = {
  pending: boolean;
  qualifiers: string[] | null;
  lockedTeamIds: string[];
  tiedTeamIds: string[];
};

const NRR_EPSILON = 1e-6;

function overs(legalBalls: number): number {
  if (legalBalls <= 0) {
    return 0;
  }
  return legalBalls / 6;
}

export function netRunRate(
  runsScored: number,
  oversFaced: number,
  runsConceded: number,
  oversBowled: number,
): number {
  const scoringRate = oversFaced > 0 ? runsScored / oversFaced : 0;
  const concedingRate = oversBowled > 0 ? runsConceded / oversBowled : 0;
  return scoringRate - concedingRate;
}

export function sameNrr(left: number, right: number): boolean {
  return Math.abs(left - right) < NRR_EPSILON;
}

export function computeStandings(
  teamIds: string[],
  matches: StandingMatch[],
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const teamId of teamIds) {
    rows.set(teamId, {
      teamId,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      points: 0,
      runsScored: 0,
      oversFaced: 0,
      runsConceded: 0,
      oversBowled: 0,
      nrr: 0,
    });
  }

  for (const match of matches) {
    if (match.status !== 'completed' && match.status !== 'draw') {
      continue;
    }
    for (const innings of match.innings) {
      if (innings.battingTeamId && rows.has(innings.battingTeamId)) {
        const row = rows.get(innings.battingTeamId)!;
        row.runsScored += innings.runs;
        row.oversFaced += overs(innings.legalBalls);
      }
      if (innings.bowlingTeamId && rows.has(innings.bowlingTeamId)) {
        const row = rows.get(innings.bowlingTeamId)!;
        row.runsConceded += innings.runs;
        row.oversBowled += overs(innings.legalBalls);
      }
    }

    for (const teamId of [match.fromTeamId, match.toTeamId]) {
      const row = rows.get(teamId);
      if (!row) {
        continue;
      }
      row.played += 1;
      if (match.status === 'draw' || !match.winnerTeamId) {
        row.drawn += 1;
        continue;
      }
      if (match.winnerTeamId === teamId) {
        row.won += 1;
        row.points += LEAGUE_WIN_POINTS;
      } else {
        row.lost += 1;
      }
    }
  }

  for (const row of rows.values()) {
    row.nrr = netRunRate(
      row.runsScored,
      row.oversFaced,
      row.runsConceded,
      row.oversBowled,
    );
  }

  return [...rows.values()].sort(compareStandingRows);
}

export function compareStandingRows(left: StandingRow, right: StandingRow): number {
  if (right.points !== left.points) {
    return right.points - left.points;
  }
  if (!sameNrr(left.nrr, right.nrr)) {
    return right.nrr - left.nrr;
  }
  return left.teamId.localeCompare(right.teamId);
}

/**
 * Top `advanceCount` teams. When points and net run rate tie across the cutoff,
 * `manualTeamIds` must name every advancing team.
 */
export function resolveAdvance(
  rows: StandingRow[],
  advanceCount: number,
  manualTeamIds?: string[],
): AdvanceResolution {
  const sorted = [...rows].sort(compareStandingRows);
  if (sorted.length < advanceCount) {
    return {
      pending: true,
      qualifiers: null,
      lockedTeamIds: [],
      tiedTeamIds: sorted.map((row) => row.teamId),
    };
  }

  const cutoff = sorted[advanceCount - 1];
  const next = sorted[advanceCount];
  const straddles =
    next != null &&
    next.points === cutoff.points &&
    sameNrr(next.nrr, cutoff.nrr);

  if (!straddles) {
    return {
      pending: false,
      qualifiers: sorted.slice(0, advanceCount).map((row) => row.teamId),
      lockedTeamIds: [],
      tiedTeamIds: [],
    };
  }

  const tied = sorted.filter(
    (row) => row.points === cutoff.points && sameNrr(row.nrr, cutoff.nrr),
  );
  const locked = sorted.filter(
    (row) =>
      row.points > cutoff.points ||
      (row.points === cutoff.points && row.nrr > cutoff.nrr + NRR_EPSILON),
  );
  const lockedIds = locked.map((row) => row.teamId);
  const tiedIds = tied.map((row) => row.teamId);
  const slots = advanceCount - locked.length;

  if (manualTeamIds && manualTeamIds.length === advanceCount) {
    const lockedSet = new Set(lockedIds);
    const tiedSet = new Set(tiedIds);
    const includesLocked = lockedIds.every((id) => manualTeamIds.includes(id));
    const extras = manualTeamIds.filter((id) => !lockedSet.has(id));
    const extrasUnique = new Set(extras);
    if (
      includesLocked &&
      extras.length === slots &&
      extrasUnique.size === slots &&
      extras.every((id) => tiedSet.has(id))
    ) {
      const selected = new Set(manualTeamIds);
      return {
        pending: false,
        qualifiers: sorted
          .filter((row) => selected.has(row.teamId))
          .map((row) => row.teamId),
        lockedTeamIds: lockedIds,
        tiedTeamIds: tiedIds,
      };
    }
  }

  return {
    pending: true,
    qualifiers: null,
    lockedTeamIds: lockedIds,
    tiedTeamIds: tiedIds,
  };
}

export function manualIds(
  tournament: TournamentDocument,
  groupLabel: string,
): string[] | undefined {
  const pick = tournament.manualQualifiers.find(
    (item) => item.groupLabel === groupLabel,
  );
  return pick?.teamIds.map((id) => resolveId(id));
}

export function uniqueTeamIds(matches: TeamMatchDocument[]): string[] {
  return [
    ...new Set(
      matches.flatMap((match) =>
        [resolveIdOrNull(match.fromTeam), resolveIdOrNull(match.toTeam)].filter(
          (id): id is string => !!id,
        ),
      ),
    ),
  ];
}

export function toStandingMatch(match: TeamMatchDocument): StandingMatch | null {
  const fromTeamId = resolveIdOrNull(match.fromTeam);
  const toTeamId = resolveIdOrNull(match.toTeam);
  if (!fromTeamId || !toTeamId) {
    return null;
  }
  const innings: InningsLine[] = (match.cricketState?.inningsSummaries ?? []).map(
    (summary) => ({
      runs: summary.runs ?? 0,
      legalBalls: summary.legalBalls ?? 0,
      battingTeamId: summary.battingTeamId
        ? resolveId(summary.battingTeamId)
        : undefined,
      bowlingTeamId: summary.bowlingTeamId
        ? resolveId(summary.bowlingTeamId)
        : undefined,
    }),
  );
  return {
    fromTeamId,
    toTeamId,
    status: match.status,
    winnerTeamId: match.winnerTeam ? resolveId(match.winnerTeam) : undefined,
    innings,
  };
}
