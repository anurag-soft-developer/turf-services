import { Model, Types } from 'mongoose';
import {
  CricketOverEventDocument,
  CricketScoringEntry,
  CricketScoringEntryKind,
} from '../cricket-over-event.schema';
import { CricketState } from '../../../matchmaking/schemas/team-match.schema';

export type LatestScoringEntryRef = {
  overDoc: CricketOverEventDocument;
  entry: CricketScoringEntry;
  indexInEvents: number;
};

/**
 * Pick the globally latest scoring entry by `recordedAt`, tie-breaking by
 * (doc.sequence, indexInEventsArray) descending.
 */
export function pickLatestScoringEntry(
  overs: CricketOverEventDocument[],
): LatestScoringEntryRef | null {
  let best: LatestScoringEntryRef | null = null;

  for (const overDoc of overs) {
    const events = overDoc.events ?? [];
    for (let i = 0; i < events.length; i++) {
      const entry = events[i];
      if (!entry?.recordedAt) continue;
      if (!best) {
        best = { overDoc, entry, indexInEvents: i };
        continue;
      }
      const t = new Date(entry.recordedAt).getTime();
      const bt = new Date(best.entry.recordedAt).getTime();
      if (t > bt) {
        best = { overDoc, entry, indexInEvents: i };
        continue;
      }
      if (t < bt) continue;
      // Same ms: higher doc sequence wins; then higher index within events.
      if (overDoc.sequence > best.overDoc.sequence) {
        best = { overDoc, entry, indexInEvents: i };
        continue;
      }
      if (
        overDoc.sequence === best.overDoc.sequence &&
        i > best.indexInEvents
      ) {
        best = { overDoc, entry, indexInEvents: i };
      }
    }
  }

  return best;
}

export async function findLatestScoringEntry(
  overEventModel: Model<CricketOverEventDocument>,
  teamMatchId: Types.ObjectId,
): Promise<LatestScoringEntryRef | null> {
  const overs = await overEventModel
    .find({ teamMatchId, 'events.0': { $exists: true } })
    .exec();
  return pickLatestScoringEntry(overs);
}

/**
 * Resolve which over doc should receive a substitution append.
 * 1) Over in progress (legal balls % 6 !== 0) for current innings
 * 2) Else latest over doc for innings
 * 3) Else caller creates a placeholder
 */
export function resolveTargetOverDocQuery(
  cs: CricketState,
): {
  preferInProgress: boolean;
  innings: number;
  inProgressOverAfter: number | null;
} {
  const innings = cs.currentInnings;
  const summary = cs.inningsSummaries[innings - 1];
  const legalBalls = summary?.legalBalls ?? 0;
  const inProgress = legalBalls > 0 && legalBalls % 6 !== 0;
  return {
    preferInProgress: inProgress,
    innings,
    inProgressOverAfter: inProgress ? Math.floor((legalBalls - 1) / 6) : null,
  };
}

export async function resolveTargetOverDoc(
  overEventModel: Model<CricketOverEventDocument>,
  teamMatchId: Types.ObjectId,
  cs: CricketState,
): Promise<CricketOverEventDocument | null> {
  const { preferInProgress, innings, inProgressOverAfter } =
    resolveTargetOverDocQuery(cs);

  if (preferInProgress && inProgressOverAfter != null) {
    const inProgress = await overEventModel.findOne({
      teamMatchId,
      innings,
      overAfter: inProgressOverAfter,
    });
    if (inProgress) return inProgress;
  }

  return overEventModel
    .findOne({ teamMatchId, innings })
    .sort({ overAfter: -1, sequence: -1 });
}

export function makeBallScoringEntry(
  payload: Omit<
    CricketScoringEntry,
    'kind' | 'recordedAt' | 'teamId' | 'playerOffParticipantId' | 'playerOnParticipantId'
  > & {
    ballInOverAfter: number;
    strikerUserId: Types.ObjectId;
    nonStrikerUserId: Types.ObjectId;
    totalRunsOnDelivery: number;
    isLegalDelivery: boolean;
  },
  recordedAt: Date = new Date(),
): CricketScoringEntry {
  return {
    kind: CricketScoringEntryKind.BALL,
    recordedAt,
    ...payload,
  };
}

export function makeSubstitutionScoringEntry(
  args: {
    teamId: Types.ObjectId;
    playerOffParticipantId: Types.ObjectId;
    playerOnParticipantId: Types.ObjectId;
  },
  recordedAt: Date = new Date(),
): CricketScoringEntry {
  return {
    kind: CricketScoringEntryKind.SUBSTITUTION,
    recordedAt,
    teamId: args.teamId,
    playerOffParticipantId: args.playerOffParticipantId,
    playerOnParticipantId: args.playerOnParticipantId,
  };
}
