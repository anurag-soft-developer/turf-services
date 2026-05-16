import { BadRequestException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import {
  CricketState,
  TeamMatchDocument,
} from '../../../matchmaking/schemas/team-match.schema';
import { AppendCricketBallDto } from '../dto/cricket-scoring.dto';
import {
  CricketBallEvent,
  CricketOverEventDocument,
  CricketWicketKind,
} from '../cricket-over-event.schema';

/** Both teams bat (standard limited-overs). Mirrors [CricketState.inningsSummaries] length. */
export const CRICKET_INNINGS_PER_MATCH = 2;

export type CricketOutcomeMapped = {
  runsOffBat: number;
  extrasWide: number;
  extrasNoBall: boolean;
  extrasBye: number;
  extrasLegBye: number;
  isWicket: boolean;
  wicketKind?: CricketWicketKind;
  totalRunsOnDelivery: number;
  isLegalDelivery: boolean;
  wicketsFallen: number;
  dismissedUserId?: Types.ObjectId;
  primaryFielderUserId?: Types.ObjectId;
};

export function finalizeInningsSummaryTeams(
  cs: CricketState,
  innIdx: number,
): void {
  const summary = cs.inningsSummaries[innIdx];
  if (!summary) {
    return;
  }
  if (innIdx === cs.currentInnings - 1) {
    summary.battingTeamId = summary.battingTeamId ?? cs.battingTeamId;
    summary.bowlingTeamId = summary.bowlingTeamId ?? cs.bowlingTeamId;
  }
}

export function resolveCricketWinnerFromInnings(
  match: TeamMatchDocument,
): Types.ObjectId | null {
  const cs = match.cricketState;
  if (!cs) {
    throw new BadRequestException('Cricket scoring not initialized');
  }

  const runsByBattingTeam = new Map<string, number>();
  for (const inn of cs.inningsSummaries) {
    if (!inn.battingTeamId) {
      throw new BadRequestException('Innings batting team is not set');
    }
    const id = inn.battingTeamId.toString();
    runsByBattingTeam.set(id, (runsByBattingTeam.get(id) ?? 0) + inn.runs);
  }

  const fromRuns = runsByBattingTeam.get(match.fromTeam.toString()) ?? 0;
  const toRuns = runsByBattingTeam.get(match.toTeam.toString()) ?? 0;

  if (fromRuns === toRuns) {
    return null;
  }
  return fromRuns > toRuns ? match.fromTeam : match.toTeam;
}

export function isCricketInningsComplete(
  cs: CricketState,
  innIdx: number,
  maxLegal: number,
): boolean {
  const summary = cs.inningsSummaries[innIdx];
  if (!summary) {
    return false;
  }

  if (summary.wickets >= 10 || summary.legalBalls >= maxLegal) {
    return true;
  }

  if (innIdx > 0) {
    const firstInningsRuns = cs.inningsSummaries[0]?.runs ?? 0;
    if (summary.runs > firstInningsRuns) {
      return true;
    }
  }

  return false;
}

export function revertMatchStateFromBall(
  match: TeamMatchDocument,
  overDoc: CricketOverEventDocument,
  removedBall: CricketBallEvent,
): void {
  const cs = match.cricketState;
  if (!cs) {
    throw new BadRequestException('Cricket scoring not initialized');
  }

  if (cs.currentInnings > overDoc.innings) {
    cs.currentInnings -= 1;
    const tmp = cs.battingTeamId;
    cs.battingTeamId = cs.bowlingTeamId;
    cs.bowlingTeamId = tmp;
  }

  const summary = cs.inningsSummaries[overDoc.innings - 1];
  if (!summary) {
    throw new BadRequestException('Invalid innings');
  }

  summary.runs -= removedBall.totalRunsOnDelivery;
  if (removedBall.isLegalDelivery) {
    summary.legalBalls -= 1;
  }
  if (removedBall.isWicket) {
    summary.wickets -= removedBall.wicketsFallen;
  }

  if (summary.runs < 0 || summary.legalBalls < 0 || summary.wickets < 0) {
    throw new BadRequestException('Cannot undo this ball');
  }

  cs.strikerUserId = removedBall.strikerUserId;
  cs.nonStrikerUserId = removedBall.nonStrikerUserId;
  cs.bowlerUserId = overDoc.bowlerUserId;
}

export function mapCricketOutcome(
  outcome: AppendCricketBallDto['outcome'],
  strikerUserId: Types.ObjectId,
): CricketOutcomeMapped {
  switch (outcome.kind) {
    case 'dot':
      return {
        runsOffBat: 0,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: false,
        totalRunsOnDelivery: 0,
        isLegalDelivery: true,
        wicketsFallen: 0,
      };
    case 'runs':
      return {
        runsOffBat: outcome.offBat,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: false,
        totalRunsOnDelivery: outcome.offBat,
        isLegalDelivery: true,
        wicketsFallen: 0,
      };
    case 'wide': {
      const total = 1 + outcome.additionalRuns;
      return {
        runsOffBat: 0,
        extrasWide: total,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: false,
        totalRunsOnDelivery: total,
        isLegalDelivery: false,
        wicketsFallen: 0,
      };
    }
    case 'no_ball':
      return {
        runsOffBat: outcome.offBat,
        extrasWide: 0,
        extrasNoBall: true,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: false,
        totalRunsOnDelivery: 1 + outcome.offBat,
        isLegalDelivery: false,
        wicketsFallen: 0,
      };
    case 'bye':
      return {
        runsOffBat: 0,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: outcome.runs,
        extrasLegBye: 0,
        isWicket: false,
        totalRunsOnDelivery: outcome.runs,
        isLegalDelivery: true,
        wicketsFallen: 0,
      };
    case 'leg_bye':
      return {
        runsOffBat: 0,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: outcome.runs,
        isWicket: false,
        totalRunsOnDelivery: outcome.runs,
        isLegalDelivery: true,
        wicketsFallen: 0,
      };
    case 'wicket_bowled':
      return {
        runsOffBat: outcome.offBat,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: true,
        wicketKind: CricketWicketKind.BOWLED,
        dismissedUserId: strikerUserId,
        totalRunsOnDelivery: outcome.offBat,
        isLegalDelivery: true,
        wicketsFallen: 1,
      };
    case 'wicket_caught':
      return {
        runsOffBat: outcome.offBat,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: true,
        wicketKind: CricketWicketKind.CAUGHT,
        dismissedUserId: strikerUserId,
        primaryFielderUserId: new Types.ObjectId(outcome.fielderUserId),
        totalRunsOnDelivery: outcome.offBat,
        isLegalDelivery: true,
        wicketsFallen: 1,
      };
    case 'wicket_lbw':
      return {
        runsOffBat: outcome.offBat,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: true,
        wicketKind: CricketWicketKind.LBW,
        dismissedUserId: strikerUserId,
        totalRunsOnDelivery: outcome.offBat,
        isLegalDelivery: true,
        wicketsFallen: 1,
      };
    case 'wicket_run_out':
      return {
        runsOffBat: outcome.runsOffBat,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: true,
        wicketKind: CricketWicketKind.RUN_OUT,
        dismissedUserId: new Types.ObjectId(outcome.dismissedUserId),
        primaryFielderUserId: outcome.fielderUserId
          ? new Types.ObjectId(outcome.fielderUserId)
          : undefined,
        totalRunsOnDelivery: outcome.runsOffBat,
        isLegalDelivery: true,
        wicketsFallen: 1,
      };
    case 'wicket_stumped':
      return {
        runsOffBat: outcome.offBat,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: true,
        wicketKind: CricketWicketKind.STUMPED,
        dismissedUserId: strikerUserId,
        primaryFielderUserId: new Types.ObjectId(outcome.wicketKeeperUserId),
        totalRunsOnDelivery: outcome.offBat,
        isLegalDelivery: true,
        wicketsFallen: 1,
      };
    case 'wicket_hit_wicket':
      return {
        runsOffBat: outcome.offBat,
        extrasWide: 0,
        extrasNoBall: false,
        extrasBye: 0,
        extrasLegBye: 0,
        isWicket: true,
        wicketKind: CricketWicketKind.HIT_WICKET,
        dismissedUserId: strikerUserId,
        totalRunsOnDelivery: outcome.offBat,
        isLegalDelivery: true,
        wicketsFallen: 1,
      };
    default:
      throw new BadRequestException('Unsupported outcome');
  }
}

export function computeOverAndBallAfter(
  legalBefore: number,
  legalAfter: number,
  isLegalDelivery: boolean,
): { overAfter: number; ballInOverAfter: number } {
  if (isLegalDelivery) {
    const C = legalAfter;
    return {
      overAfter: Math.floor((C - 1) / 6),
      ballInOverAfter: ((C - 1) % 6) + 1,
    };
  }
  const C = legalBefore;
  if (C === 0) {
    return { overAfter: 0, ballInOverAfter: 1 };
  }
  return {
    overAfter: Math.floor((C - 1) / 6),
    ballInOverAfter: ((C - 1) % 6) + 1,
  };
}

export async function getDismissedBatsmenUserIds(
  overEventModel: Model<CricketOverEventDocument>,
  teamMatchOid: Types.ObjectId,
  innings: number,
): Promise<Set<string>> {
  const outs = new Set<string>();
  const overs = await overEventModel
    .find({ teamMatchId: teamMatchOid, innings })
    .select({ ballEvents: 1 })
    .lean();
  for (const o of overs) {
    for (const b of o.ballEvents ?? []) {
      if (b.isWicket && b.dismissedUserId && (b.wicketsFallen ?? 0) >= 1) {
        outs.add(b.dismissedUserId.toString());
      }
    }
  }
  return outs;
}
