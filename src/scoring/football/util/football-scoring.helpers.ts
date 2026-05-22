import { Types } from 'mongoose';
import {
  FootballPeriod,
  TeamMatchDocument,
} from '../../../matchmaking/schemas/team-match.schema';
import { FootballMatchEvent } from '../football-match-event.schema';
import {
  revertFootballScoreDeltas,
  resolveFootballWinnerFromInnings,
} from './football-innings.helpers';

export { resolveFootballWinnerFromInnings as resolveFootballWinnerFromScore };

export function revertMatchStateFromEvent(
  match: TeamMatchDocument,
  removed: FootballMatchEvent,
  previous: FootballMatchEvent | null,
): void {
  const fs = match.footballState;
  if (!fs) {
    return;
  }

  revertFootballScoreDeltas(
    fs,
    removed.scoreDeltaTeamOne,
    removed.scoreDeltaTeamTwo,
    removed.innings,
  );

  if (removed.innings < fs.currentInnings) {
    fs.currentInnings = removed.innings;
  }

  if (previous) {
    fs.currentPeriod = previous.period;
    fs.matchMinute = previous.matchMinute;
    if (previous.innings !== fs.currentInnings) {
      fs.currentInnings = previous.innings;
    }
  } else {
    fs.currentPeriod = FootballPeriod.FIRST_HALF;
    fs.matchMinute = undefined;
    fs.currentInnings = 1;
  }
}
