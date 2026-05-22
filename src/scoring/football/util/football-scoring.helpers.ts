import { Types } from 'mongoose';
import {
  FootballPeriod,
  TeamMatchDocument,
} from '../../../matchmaking/schemas/team-match.schema';
import { FootballMatchEvent } from '../football-match-event.schema';

/** Returns winner team id, or null when scores are level (draw). */
export function resolveFootballWinnerFromScore(
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

export function revertMatchStateFromEvent(
  match: TeamMatchDocument,
  removed: FootballMatchEvent,
  previous: FootballMatchEvent | null,
): void {
  const fs = match.footballState;
  if (!fs) {
    return;
  }

  fs.scoreTeamOne -= removed.scoreDeltaTeamOne;
  fs.scoreTeamTwo -= removed.scoreDeltaTeamTwo;

  if (previous) {
    fs.currentPeriod = previous.period;
    fs.matchMinute = previous.matchMinute;
  } else {
    fs.currentPeriod = FootballPeriod.FIRST_HALF;
    fs.matchMinute = undefined;
  }
}
