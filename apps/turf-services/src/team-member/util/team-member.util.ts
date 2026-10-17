import { NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { resolveId } from '../../core/utils/mongo-ref.util';
import {
  OpeningDocument,
  OpeningStatus,
  OpeningType,
} from '../../openings/schemas/opening.schema';
import {
  LeadershipRole,
  TeamMemberDocument,
  TeamMemberStatus,
} from '../schemas/team-member.schema';

export function toObjectIds(
  ids: Array<string | Types.ObjectId>,
): Types.ObjectId[] {
  const objectIds: Types.ObjectId[] = [];
  for (const id of ids) {
    if (id instanceof Types.ObjectId) {
      objectIds.push(id);
      continue;
    }
    const raw = String(id);
    if (!Types.ObjectId.isValid(raw)) continue;
    objectIds.push(new Types.ObjectId(raw));
  }
  return objectIds;
}

export function teamSportOf(doc: TeamMemberDocument): string | undefined {
  const team = doc.team;
  if (!team || typeof team !== 'object') return undefined;
  return (team as { sportType?: string }).sportType;
}

export async function liveOpeningId(
  openingModel: Model<OpeningDocument>,
  teamId: string,
): Promise<string | undefined> {
  const opening = await openingModel
    .findOne({
      type: OpeningType.TEAM,
      teamId: new Types.ObjectId(teamId),
      status: { $in: [OpeningStatus.OPEN, OpeningStatus.ON_HOLD] },
    })
    .select('_id');
  return opening?._id.toString();
}

export async function clearConflictingLeadership(
  teamMemberModel: Model<TeamMemberDocument>,
  teamId: string,
  exceptMembershipId: string,
  role: LeadershipRole,
): Promise<void> {
  await teamMemberModel.updateMany(
    {
      team: new Types.ObjectId(teamId),
      status: TeamMemberStatus.ACTIVE,
      leadershipRole: role,
      _id: { $ne: new Types.ObjectId(exceptMembershipId) },
    },
    { $unset: { leadershipRole: 1 } },
  );
}

export async function requireMembership(
  teamMemberModel: Model<TeamMemberDocument>,
  id: string,
  teamId: string,
): Promise<TeamMemberDocument> {
  const membership = await teamMemberModel.findById(id);
  if (!membership || resolveId(membership.team) !== resolveId(teamId)) {
    throw new NotFoundException('Team membership not found');
  }
  return membership;
}
