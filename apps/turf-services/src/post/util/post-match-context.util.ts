import { Types } from 'mongoose';
import {
  MatchProposalStatus,
  TeamMatchDocument,
} from '../../matchmaking/schemas/team-match.schema';
import { resolveId } from '../../core/utils/mongo-ref.util';

/** Selected or accepted turf on a match, if any. */
export function tryResolveSelectedTurfId(
  match: TeamMatchDocument,
): Types.ObjectId | undefined {
  const selected = match.selectedTurfProposalId
    ? match.proposedTurfs.find(
        (p) =>
          resolveId(p.proposalId) ===
          resolveId(match.selectedTurfProposalId!),
      )
    : match.proposedTurfs.find(
        (p) => p.status === MatchProposalStatus.ACCEPTED,
      );
  if (!selected) return undefined;
  return new Types.ObjectId(resolveId(selected.turfId));
}
