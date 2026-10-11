import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { resolveId, resolveIdOrNull } from '../core/utils/mongo-ref.util';
import {
  TeamMatch,
  TeamMatchDocument,
  TeamMatchSource,
  TeamMatchStatus,
} from '../matchmaking/schemas/team-match.schema';
import { SportType } from '../team/schemas/team.schema';
import { Tournament, TournamentDocument } from './schemas/tournament.schema';
import {
  HYBRID_ADVANCE_COUNT,
  HYBRID_LEAGUE_QUALIFIER_LABEL,
  hybridKnockoutBracketSize,
  knockoutFinalRound,
  TournamentFormat,
  TournamentStage,
  TournamentStatus,
} from './tournament.constants';
import {
  advancingFrom,
  advancingTeamId,
  indexByMatchNumber,
  isUnstartedFixture,
  knockoutSkeletonReady,
  matchesFedBy,
  sortedSources,
} from './util/tournament-bracket.util';
import {
  bracketFirstRoundPairs,
  DerivedPlan,
  hasResult,
  isDerivedFixture,
  planMatches,
} from './util/tournament-draw.util';
import {
  AdvanceResolution,
  computeStandings,
  manualIds,
  resolveAdvance,
  StandingMatch,
  StandingRow,
  toStandingMatch,
  uniqueTeamIds,
} from './util/tournament-standings.util';

@Injectable()
export class TournamentDrawService {
  private readonly logger = new Logger(TournamentDrawService.name);
  /** One draw sync per tournament. Fixtures and the table both call sync. */
  private readonly syncTail = new Map<string, Promise<unknown>>();

  constructor(
    @InjectModel(Tournament.name)
    private readonly tournamentModel: Model<TournamentDocument>,
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
  ) {}

  async markOngoing(tournamentId: string): Promise<void> {
    await this.tournamentModel.updateOne(
      { _id: tournamentId, status: TournamentStatus.SCHEDULED },
      { $set: { status: TournamentStatus.ONGOING } },
    );
  }

  async syncFromMatch(match: TeamMatchDocument): Promise<void> {
    if (!match.tournamentId) {
      return;
    }
    if (
      match.status === TeamMatchStatus.COMPLETED ||
      match.status === TeamMatchStatus.DRAW
    ) {
      await this.sync(resolveId(match.tournamentId));
      return;
    }
    if (match.status === TeamMatchStatus.ONGOING) {
      await this.markOngoing(resolveId(match.tournamentId));
    }
  }

  async sync(tournamentId: string): Promise<TournamentDocument | null> {
    const previous = this.syncTail.get(tournamentId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => this.runSync(tournamentId));
    this.syncTail.set(tournamentId, run);
    try {
      return await run;
    } finally {
      if (this.syncTail.get(tournamentId) === run) {
        this.syncTail.delete(tournamentId);
      }
    }
  }

  private async runSync(tournamentId: string): Promise<TournamentDocument | null> {
    const tournament = await this.tournamentModel.findById(tournamentId);
    if (!tournament || tournament.status === TournamentStatus.CANCELLED) {
      return tournament;
    }
    if (
      tournament.status === TournamentStatus.DRAFT ||
      tournament.status === TournamentStatus.INVITING
    ) {
      return tournament;
    }

    for (let pass = 0; pass < 6; pass += 1) {
      const matches = await this.teamMatchModel
        .find({ tournamentId: tournament._id })
        .exec();
      const changed = await this.reconcile(tournament, matches);
      if (!changed) {
        break;
      }
    }

    const matches = await this.teamMatchModel
      .find({ tournamentId: tournament._id })
      .exec();
    const nextStatus = this.resolveStatus(tournament, matches);
    if (nextStatus !== tournament.status) {
      tournament.status = nextStatus;
      await tournament.save();
    }
    return tournament;
  }

  async buildTable(tournament: TournamentDocument) {
    const maxTeams = tournament.maxTeams;
    if (maxTeams == null) {
      return {
        standings: [],
        pendingQualifiers: [],
        pendingBracketPicks: [],
      };
    }
    const matches = await this.teamMatchModel
      .find({ tournamentId: tournament._id })
      .exec();
    const groups = this.groupLabels(matches);
    const knockoutOnly =
      !matches.some(
        (match) =>
          match.stage === TournamentStage.GROUP ||
          match.stage === TournamentStage.LEAGUE,
      ) && matches.some((match) => match.stage === TournamentStage.KNOCKOUT);
    const standings = groups.map((label) => {
      const groupMatches = matches.filter((match) => {
        if (label) {
          return (
            match.stage === TournamentStage.GROUP && match.groupLabel === label
          );
        }
        if (knockoutOnly) {
          return match.stage === TournamentStage.KNOCKOUT;
        }
        return match.stage === TournamentStage.LEAGUE;
      });
      const teamIds = uniqueTeamIds(groupMatches).filter((id) => !!id);
      const rows = computeStandings(
        teamIds,
        groupMatches
          .map(toStandingMatch)
          .filter((item): item is StandingMatch => item != null),
      );
      const advanceCount =
        tournament.format === TournamentFormat.HYBRID
          ? (tournament.advanceCount ?? hybridKnockoutBracketSize(maxTeams))
          : null;
      const resolution =
        advanceCount == null
          ? null
          : resolveAdvance(
              rows,
              advanceCount,
              manualIds(tournament, label ?? ''),
            );
      return {
        groupLabel: label,
        rows,
        advance: resolution,
      };
    });

    return {
      standings,
      pendingQualifiers: standings
        .filter((group) => group.advance?.pending)
        .map((group) => ({
          groupLabel: group.groupLabel ?? HYBRID_LEAGUE_QUALIFIER_LABEL,
          advanceCount:
            tournament.advanceCount ?? hybridKnockoutBracketSize(maxTeams),
          lockedTeamIds: group.advance?.lockedTeamIds ?? [],
          tiedTeamIds: group.advance?.tiedTeamIds ?? [],
        })),
      pendingBracketPicks: matches
        .filter(
          (match) =>
            match.stage === TournamentStage.KNOCKOUT &&
            match.status === TeamMatchStatus.DRAW &&
            !match.tournamentBracketWinner,
        )
        .flatMap((match) => {
          const fromTeamId = resolveIdOrNull(match.fromTeam);
          const toTeamId = resolveIdOrNull(match.toTeam);
          if (!fromTeamId || !toTeamId) {
            return [];
          }
          return [
            {
              matchId: match._id.toString(),
              matchNumber: match.matchNumber,
              round: match.round,
              fromTeamId,
              toTeamId,
            },
          ];
        }),
    };
  }

  private async reconcile(
    tournament: TournamentDocument,
    matches: TeamMatchDocument[],
  ): Promise<boolean> {
    if (knockoutSkeletonReady(tournament, matches)) {
      return this.fillKnockoutSlots(matches);
    }
    const plans = [
      ...this.hybridSeedPlans(tournament, matches),
      ...this.knockoutChildPlans(matches),
    ];
    let changed = false;

    for (const plan of plans) {
      let existing = matches.find((match) => planMatches(match, plan));
      if (!existing) {
        existing = await this.createFixture(tournament, matches, plan);
        changed = true;
      }
      if (
        existing.status === TeamMatchStatus.SCHEDULE_FINALIZED &&
        (resolveIdOrNull(existing.fromTeam) !== plan.fromTeamId ||
          resolveIdOrNull(existing.toTeam) !== plan.toTeamId)
      ) {
        existing.fromTeam = new Types.ObjectId(plan.fromTeamId);
        existing.toTeam = new Types.ObjectId(plan.toTeamId);
        existing.tournamentBracketWinner = undefined;
        await existing.save();
        changed = true;
      }
    }

    for (const match of [...matches]) {
      if (!isDerivedFixture(match)) {
        continue;
      }
      if (match.status !== TeamMatchStatus.SCHEDULE_FINALIZED) {
        continue;
      }
      const stillExpected = plans.some((plan) => planMatches(match, plan));
      if (stillExpected) {
        continue;
      }
      await match.deleteOne();
      const index = matches.indexOf(match);
      if (index >= 0) {
        matches.splice(index, 1);
      }
      changed = true;
    }

    return changed;
  }

  /** Write feeder winners onto empty knockout slots. Manual sides stay until a winner exists. */
  private async fillKnockoutSlots(
    matches: TeamMatchDocument[],
  ): Promise<boolean> {
    const byNumber = indexByMatchNumber(matches);
    let changed = false;

    for (const match of matches) {
      if (match.stage !== TournamentStage.KNOCKOUT) {
        continue;
      }
      if (match.status !== TeamMatchStatus.SCHEDULE_FINALIZED) {
        continue;
      }
      const sources = sortedSources(match);
      if (sources.length < 2) {
        continue;
      }
      const homeWinner = advancingFrom(byNumber.get(sources[0]));
      const awayWinner = advancingFrom(byNumber.get(sources[1]));
      let dirty = false;
      if (homeWinner && resolveIdOrNull(match.fromTeam) !== homeWinner) {
        match.fromTeam = new Types.ObjectId(homeWinner);
        dirty = true;
      }
      if (awayWinner && resolveIdOrNull(match.toTeam) !== awayWinner) {
        match.toTeam = new Types.ObjectId(awayWinner);
        dirty = true;
      }
      if (!dirty) {
        continue;
      }
      match.tournamentBracketWinner = undefined;
      await match.save();
      changed = true;
    }

    return changed;
  }

  /**
   * Drop the side of each unstarted fixture that is fed by [matchNumber].
   * Started fixtures are left as they are.
   */
  async clearUnstartedFeederSides(
    tournamentId: string,
    matchNumber: number,
  ): Promise<void> {
    const matches = await this.teamMatchModel.find({ tournamentId }).exec();
    for (const { match, side } of matchesFedBy(matchNumber, matches)) {
      if (!isUnstartedFixture(match)) {
        continue;
      }
      if (resolveIdOrNull(match[side]) == null && !match.tournamentBracketWinner) {
        continue;
      }
      match.set(side, undefined);
      match.tournamentBracketWinner = undefined;
      await match.save();
    }
  }

  private hybridSeedPlans(
    tournament: TournamentDocument,
    matches: TeamMatchDocument[],
  ): DerivedPlan[] {
    if (tournament.format !== TournamentFormat.HYBRID) {
      return [];
    }
    const hasGroupStage = matches.some(
      (match) => match.stage === TournamentStage.GROUP,
    );
    if (!hasGroupStage) {
      return this.hybridLeagueKnockoutSeedPlans(tournament, matches);
    }
    const labels = [
      ...new Set(
        matches
          .filter((match) => match.stage === TournamentStage.GROUP)
          .map((match) => match.groupLabel)
          .filter((label): label is string => !!label),
      ),
    ].sort();
    if (!labels.length) {
      return [];
    }

    const qualifiers = new Map<string, string[]>();
    for (const label of labels) {
      const groupMatches = matches.filter(
        (match) =>
          match.stage === TournamentStage.GROUP && match.groupLabel === label,
      );
      if (!groupMatches.length || !groupMatches.every(hasResult)) {
        return [];
      }
      const resolution = this.resolutionFor(
        tournament,
        label,
        groupMatches,
      );
      if (!resolution.qualifiers) {
        return [];
      }
      qualifiers.set(label, resolution.qualifiers);
    }

    if (tournament.maxTeams === 4) {
      const pair = qualifiers.get('A');
      if (!pair || pair.length < 2) {
        return [];
      }
      return [
        {
          bracketKey: 'hybrid-final',
          round: 1,
          fromTeamId: pair[0],
          toTeamId: pair[1],
        },
      ];
    }

    const groupA = qualifiers.get('A');
    const groupB = qualifiers.get('B');
    if (!groupA || !groupB || groupA.length < 2 || groupB.length < 2) {
      return [];
    }
    return [
      {
        bracketKey: 'hybrid-semi-1',
        round: 1,
        fromTeamId: groupA[0],
        toTeamId: groupB[1],
      },
      {
        bracketKey: 'hybrid-semi-2',
        round: 1,
        fromTeamId: groupA[1],
        toTeamId: groupB[0],
      },
    ];
  }

  /**
   * Round-robin league phase, then top K into a standard knockout bracket.
   * Keep returning these plans after the semis exist so the cleanup does not
   * delete them on the next sync.
   */
  private hybridLeagueKnockoutSeedPlans(
    tournament: TournamentDocument,
    matches: TeamMatchDocument[],
  ): DerivedPlan[] {
    const leagueMatches = matches.filter(
      (match) => match.stage === TournamentStage.LEAGUE,
    );
    if (!leagueMatches.length || !leagueMatches.every(hasResult)) {
      return [];
    }
    const maxTeams = tournament.maxTeams;
    if (maxTeams == null) {
      return [];
    }
    const advanceCount =
      tournament.advanceCount ?? hybridKnockoutBracketSize(maxTeams);
    const resolution = this.resolutionFor(
      tournament,
      HYBRID_LEAGUE_QUALIFIER_LABEL,
      leagueMatches,
      advanceCount,
    );
    if (!resolution.qualifiers?.length) {
      return [];
    }
    const pairs = bracketFirstRoundPairs(resolution.qualifiers);
    return pairs.map((pair, index) => ({
      bracketKey: `hybrid-ko-r1-${index + 1}`,
      round: 1,
      fromTeamId: pair[0],
      toTeamId: pair[1],
    }));
  }

  private knockoutChildPlans(matches: TeamMatchDocument[]): DerivedPlan[] {
    const knockout = matches.filter(
      (match) => match.stage === TournamentStage.KNOCKOUT,
    );
    const rounds = [
      ...new Set(knockout.map((match) => match.round ?? 0)),
    ].sort((left, right) => left - right);
    const plans: DerivedPlan[] = [];

    for (const round of rounds) {
      const inRound = knockout
        .filter((match) => match.round === round)
        .sort((left, right) => (left.matchNumber ?? 0) - (right.matchNumber ?? 0));
      for (let index = 0; index + 1 < inRound.length; index += 2) {
        const home = inRound[index];
        const away = inRound[index + 1];
        const homeWinner = advancingTeamId(home);
        const awayWinner = advancingTeamId(away);
        if (!homeWinner || !awayWinner || home.matchNumber == null || away.matchNumber == null) {
          continue;
        }
        plans.push({
          round: round + 1,
          fromTeamId: homeWinner,
          toTeamId: awayWinner,
          sourceMatchNumbers: [home.matchNumber, away.matchNumber].sort(
            (left, right) => left - right,
          ),
        });
      }
    }

    return plans;
  }

  private resolutionFor(
    tournament: TournamentDocument,
    groupLabel: string,
    matches: TeamMatchDocument[],
    advanceCount?: number,
  ): AdvanceResolution {
    const rows: StandingRow[] = computeStandings(
      uniqueTeamIds(matches),
      matches
        .map(toStandingMatch)
        .filter((item): item is StandingMatch => item != null),
    );
    const maxTeams = tournament.maxTeams;
    const count =
      advanceCount ??
      tournament.advanceCount ??
      (tournament.format === TournamentFormat.HYBRID && maxTeams != null
        ? hybridKnockoutBracketSize(maxTeams)
        : HYBRID_ADVANCE_COUNT);
    return resolveAdvance(rows, count, manualIds(tournament, groupLabel));
  }

  private async createFixture(
    tournament: TournamentDocument,
    matches: TeamMatchDocument[],
    plan: DerivedPlan,
  ): Promise<TeamMatchDocument> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fresh = await this.teamMatchModel
        .find({ tournamentId: tournament._id })
        .exec();
      for (const match of fresh) {
        this.rememberMatch(matches, match);
      }
      const already = fresh.find((match) => planMatches(match, plan));
      if (already) {
        return already;
      }
      const matchNumber =
        fresh.reduce((max, match) => Math.max(max, match.matchNumber ?? 0), 0) +
        1;
      try {
        const created = await this.teamMatchModel.create({
          source: TeamMatchSource.RANKED,
          fromTeam: new Types.ObjectId(plan.fromTeamId),
          toTeam: new Types.ObjectId(plan.toTeamId),
          sportType: SportType.CRICKET,
          status: TeamMatchStatus.SCHEDULE_FINALIZED,
          tournamentId: tournament._id,
          stage: TournamentStage.KNOCKOUT,
          round: plan.round,
          matchNumber,
          ...(plan.sourceMatchNumbers
            ? { sourceMatchNumbers: plan.sourceMatchNumbers }
            : {}),
          ...(plan.bracketKey ? { bracketKey: plan.bracketKey } : {}),
          statusUpdatedAt: new Date(),
        });
        this.rememberMatch(matches, created);
        this.logger.log(
          `Created tournament fixture ${created._id.toString()} for ${tournament._id.toString()}`,
        );
        return created;
      } catch (error) {
        if (!isDuplicateMatchNumber(error) || attempt === 2) {
          throw error;
        }
      }
    }
    throw new Error('Could not create the tournament fixture');
  }

  private rememberMatch(
    matches: TeamMatchDocument[],
    match: TeamMatchDocument,
  ) {
    const id = match._id.toString();
    const index = matches.findIndex((item) => item._id.toString() === id);
    if (index >= 0) {
      matches[index] = match;
      return;
    }
    matches.push(match);
  }

  private resolveStatus(
    tournament: TournamentDocument,
    matches: TeamMatchDocument[],
  ): TournamentStatus {
    const started = matches.some(
      (match) =>
        match.status === TeamMatchStatus.ONGOING ||
        match.status === TeamMatchStatus.COMPLETED ||
        match.status === TeamMatchStatus.DRAW,
    );
    if (tournament.format === TournamentFormat.LEAGUE) {
      if (matches.length > 0 && matches.every(hasResult)) {
        return TournamentStatus.COMPLETED;
      }
      return started ? TournamentStatus.ONGOING : TournamentStatus.SCHEDULED;
    }

    const maxTeams = tournament.maxTeams;
    if (maxTeams == null) {
      return started ? TournamentStatus.ONGOING : tournament.status;
    }
    const finalRound = knockoutFinalRound(
      tournament.format,
      maxTeams,
      tournament.advanceCount,
    );
    const final = matches.find(
      (match) =>
        match.stage === TournamentStage.KNOCKOUT && match.round === finalRound,
    );
    if (final && advancingTeamId(final)) {
      return TournamentStatus.COMPLETED;
    }
    return started ? TournamentStatus.ONGOING : TournamentStatus.SCHEDULED;
  }

  private groupLabels(matches: TeamMatchDocument[]): Array<string | null> {
    const labels = [
      ...new Set(
        matches
          .filter((match) => match.stage === TournamentStage.GROUP)
          .map((match) => match.groupLabel)
          .filter((label): label is string => !!label),
      ),
    ].sort();
    if (labels.length) {
      return labels;
    }
    if (matches.some((match) => match.stage === TournamentStage.LEAGUE)) {
      return [null];
    }
    // Pure knockout: one standings board (P/W/D/L/Pts from completed fixtures).
    if (matches.some((match) => match.stage === TournamentStage.KNOCKOUT)) {
      return [null];
    }
    return [];
  }
}

function isDuplicateMatchNumber(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: number }).code;
  if (code === 11000) {
    return true;
  }
  const cause = (error as { cause?: { code?: number } }).cause;
  return cause?.code === 11000;
}
