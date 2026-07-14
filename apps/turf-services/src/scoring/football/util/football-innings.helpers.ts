import { BadRequestException } from '@nestjs/common';
import {
  FootballPeriod,
  FootballState,
  TeamMatchDocument,
} from '../../../matchmaking/schemas/team-match.schema';
import { Types } from 'mongoose';

/** Standard halves (mirrors limited-overs cricket innings count). */
export const FOOTBALL_INNINGS_PER_MATCH = 2;

export function defaultPeriodForInnings(innings: number): FootballPeriod {
  switch (innings) {
    case 1:
      return FootballPeriod.FIRST_HALF;
    case 2:
      return FootballPeriod.SECOND_HALF;
    case 3:
      return FootballPeriod.EXTRA_FIRST;
    case 4:
      return FootballPeriod.EXTRA_SECOND;
    default:
      return FootballPeriod.PENALTIES;
  }
}

export function createFootballInningsSummaries(
  count: number,
  firstPeriod: FootballPeriod,
): FootballState['inningsSummaries'] {
  return Array.from({ length: count }, (_, i) => ({
    scoreTeamOne: 0,
    scoreTeamTwo: 0,
    period: i === 0 ? firstPeriod : undefined,
  }));
}

export function getCurrentInningsSummary(fs: FootballState) {
  const idx = fs.currentInnings - 1;
  const summary = fs.inningsSummaries[idx];
  if (!summary) {
    throw new BadRequestException('Invalid innings');
  }
  return summary;
}

export function applyFootballScoreDeltas(
  fs: FootballState,
  d1: number,
  d2: number,
): void {
  fs.scoreTeamOne += d1;
  fs.scoreTeamTwo += d2;
  const summary = getCurrentInningsSummary(fs);
  summary.scoreTeamOne += d1;
  summary.scoreTeamTwo += d2;
}

export function revertFootballScoreDeltas(
  fs: FootballState,
  d1: number,
  d2: number,
  innings: number,
): void {
  fs.scoreTeamOne -= d1;
  fs.scoreTeamTwo -= d2;
  const summary = fs.inningsSummaries[innings - 1];
  if (summary) {
    summary.scoreTeamOne -= d1;
    summary.scoreTeamTwo -= d2;
  }
}

export function finalizeFootballInningsSummary(
  fs: FootballState,
  innIdx: number,
): void {
  const summary = fs.inningsSummaries[innIdx];
  if (!summary) {
    return;
  }
  summary.period = summary.period ?? fs.currentPeriod;
}

export function syncFootballTotalsFromInnings(fs: FootballState): void {
  let t1 = 0;
  let t2 = 0;
  for (const inn of fs.inningsSummaries) {
    t1 += inn.scoreTeamOne;
    t2 += inn.scoreTeamTwo;
  }
  fs.scoreTeamOne = t1;
  fs.scoreTeamTwo = t2;
}

export function resolveFootballWinnerFromInnings(
  match: TeamMatchDocument,
): Types.ObjectId | null {
  const fs = match.footballState;
  if (!fs) {
    return null;
  }
  if (fs.scoreTeamOne === fs.scoreTeamTwo) {
    return null;
  }
  return fs.scoreTeamOne > fs.scoreTeamTwo ? match.fromTeam : match.toTeam;
}

export function pauseFootballTimer(fs: FootballState): void {
  if (fs.isTimerPaused) {
    return;
  }
  if (fs.timerStartedAt) {
    fs.timerElapsedMs += Date.now() - new Date(fs.timerStartedAt).getTime();
  }
  fs.timerStartedAt = undefined;
  fs.isTimerPaused = true;
}

export function resumeFootballTimer(fs: FootballState): void {
  if (!fs.isTimerPaused) {
    return;
  }
  fs.timerStartedAt = new Date();
  fs.isTimerPaused = false;
}

export function getFootballTimerElapsedMs(fs: FootballState): number {
  if (!fs.isTimerPaused && fs.timerStartedAt) {
    return (
      fs.timerElapsedMs + (Date.now() - new Date(fs.timerStartedAt).getTime())
    );
  }
  return fs.timerElapsedMs;
}

export function getFootballTotalTimerElapsedMs(fs: FootballState): number {
  return (fs.totalTimerElapsedMs ?? 0) + getFootballTimerElapsedMs(fs);
}

/** Flush current innings timer into [totalTimerElapsedMs] and reset for next innings. */
export function resetFootballInningTimer(fs: FootballState): void {
  pauseFootballTimer(fs);
  fs.totalTimerElapsedMs =
    (fs.totalTimerElapsedMs ?? 0) + getFootballTimerElapsedMs(fs);
  fs.timerElapsedMs = 0;
  fs.timerStartedAt = undefined;
  fs.isTimerPaused = true;
}
