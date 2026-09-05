import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import {
  BatchPersistChatMessage,
  ChatScope,
  normalizePlayerScopeId,
} from '../../../../../libs';
import { TeamMemberService } from '../../team-member/team-member.service';
import {
  TeamMemberDocument,
  TeamMemberStatus,
} from '../../team-member/schemas/team-member.schema';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { resolveId } from '../../core/utils/mongo-ref.util';

export async function assertScopeAccess(
  userId: string,
  scope: ChatScope,
  scopeId: string,
  teamMemberService: TeamMemberService,
  teamMatchModel: Model<TeamMatchDocument>,
): Promise<void> {
  if (scope === 'team') {
    const isMember = await teamMemberService.hasActiveMembership(
      scopeId,
      userId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        'User is not an active member of this team',
      );
    }
    return;
  }

  if (scope === 'match') {
    const match = await teamMatchModel.findById(scopeId).lean();
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const activeTeamIds =
      await teamMemberService.distinctActiveTeamIds(userId);
    const activeSet = new Set(activeTeamIds.map((id) => resolveId(id)));
    const isRelated =
      activeSet.has(resolveId(match.fromTeam)) ||
      activeSet.has(resolveId(match.toTeam));

    if (!isRelated) {
      throw new ForbiddenException('User is not part of this match');
    }
    return;
  }

  assertPlayerScopeAccess(userId, scopeId);
}

export function assertPlayerScopeAccess(userId: string, scopeId: string): void {
  const participants = scopeId.split(':').filter(Boolean);
  if (participants.length !== 2) {
    throw new BadRequestException('Invalid player scopeId format');
  }

  if (!participants.includes(userId)) {
    throw new ForbiddenException(
      'User is not a participant in this player chat',
    );
  }

  const normalized = normalizePlayerScopeId(participants[0], participants[1]);
  if (normalized !== scopeId) {
    throw new BadRequestException('Player scopeId is not normalized');
  }
}

export async function listChatParticipantUserIds(
  scope: ChatScope,
  scopeId: string,
  teamMemberService: TeamMemberService,
  teamMatchModel: Model<TeamMatchDocument>,
): Promise<string[]> {
  if (scope === 'team') {
    return teamMemberService.distinctActiveUserIds([scopeId]);
  }

  if (scope === 'match') {
    const match = await teamMatchModel.findById(scopeId).lean();
    if (!match) {
      return [];
    }
    return teamMemberService.distinctActiveUserIds([
      resolveId(match.fromTeam),
      resolveId(match.toTeam),
    ]);
  }

  const participants = scopeId.split(':').filter(Boolean);
  return participants.length === 2 ? participants : [];
}

export async function resolvePersistableMessages(
  messages: BatchPersistChatMessage[],
  teamMemberModel: Model<TeamMemberDocument>,
  teamMatchModel: Model<TeamMatchDocument>,
): Promise<{
  allowedMessages: BatchPersistChatMessage[];
  failedMessageIds: string[];
}> {
  const allowedKeys = await resolveAllowedPersistKeys(
    messages,
    teamMemberModel,
    teamMatchModel,
  );
  const allowedMessages: BatchPersistChatMessage[] = [];
  const failedMessageIds: string[] = [];

  for (const message of messages) {
    if (allowedKeys.has(persistAccessKey(message))) {
      allowedMessages.push(message);
    } else {
      failedMessageIds.push(message.messageId);
    }
  }

  return { allowedMessages, failedMessageIds };
}

function persistAccessKey(ref: {
  senderUserId: string;
  scope: ChatScope;
  scopeId: string;
}): string {
  return `${ref.senderUserId}:${ref.scope}:${ref.scopeId}`;
}

async function resolveAllowedPersistKeys(
  messages: BatchPersistChatMessage[],
  teamMemberModel: Model<TeamMemberDocument>,
  teamMatchModel: Model<TeamMatchDocument>,
): Promise<Set<string>> {
  const unique = new Map<string, BatchPersistChatMessage>();
  for (const message of messages) {
    const key = persistAccessKey(message);
    if (!unique.has(key)) {
      unique.set(key, message);
    }
  }

  const teamRefs: BatchPersistChatMessage[] = [];
  const matchRefs: BatchPersistChatMessage[] = [];
  const allowed = new Set<string>();

  for (const message of unique.values()) {
    if (message.scope === 'team') {
      teamRefs.push(message);
      continue;
    }
    if (message.scope === 'match') {
      matchRefs.push(message);
      continue;
    }
    try {
      assertPlayerScopeAccess(message.senderUserId, message.scopeId);
      allowed.add(persistAccessKey(message));
    } catch {
      // Invalid or unauthorized player rooms fail that unique key.
    }
  }

  const [teamAllowed, matchAllowed] = await Promise.all([
    resolveAllowedTeamKeys(teamRefs, teamMemberModel),
    resolveAllowedMatchKeys(matchRefs, teamMemberModel, teamMatchModel),
  ]);
  for (const key of teamAllowed) {
    allowed.add(key);
  }
  for (const key of matchAllowed) {
    allowed.add(key);
  }
  return allowed;
}

async function resolveAllowedTeamKeys(
  refs: BatchPersistChatMessage[],
  teamMemberModel: Model<TeamMemberDocument>,
): Promise<Set<string>> {
  if (!refs.length) {
    return new Set();
  }

  const membershipKeys = await findActiveMembershipKeys(
    teamMemberModel,
    refs.map((ref) => ({
      teamId: ref.scopeId,
      userId: ref.senderUserId,
    })),
  );

  const allowed = new Set<string>();
  for (const ref of refs) {
    if (membershipKeys.has(`${ref.scopeId}:${ref.senderUserId}`)) {
      allowed.add(persistAccessKey(ref));
    }
  }
  return allowed;
}

async function resolveAllowedMatchKeys(
  refs: BatchPersistChatMessage[],
  teamMemberModel: Model<TeamMemberDocument>,
  teamMatchModel: Model<TeamMatchDocument>,
): Promise<Set<string>> {
  if (!refs.length) {
    return new Set();
  }

  const matchObjectIds = [
    ...new Set(
      refs.map((ref) => ref.scopeId).filter((id) => Types.ObjectId.isValid(id)),
    ),
  ].map((id) => new Types.ObjectId(id));

  const [matches, teamsByUser] = await Promise.all([
    matchObjectIds.length
      ? teamMatchModel
          .find({ _id: { $in: matchObjectIds } })
          .select('fromTeam toTeam')
          .lean()
      : [],
    activeTeamIdsByUserIds(
      teamMemberModel,
      refs.map((ref) => ref.senderUserId),
    ),
  ]);

  const matchById = new Map(
    matches.map((match): [string, typeof match] => [
      match._id.toString(),
      match,
    ]),
  );
  const allowed = new Set<string>();
  for (const ref of refs) {
    const match = matchById.get(ref.scopeId);
    if (!match) {
      continue;
    }
    const activeSet = teamsByUser.get(ref.senderUserId);
    if (
      !activeSet?.has(resolveId(match.fromTeam)) &&
      !activeSet?.has(resolveId(match.toTeam))
    ) {
      continue;
    }
    allowed.add(persistAccessKey(ref));
  }
  return allowed;
}

async function findActiveMembershipKeys(
  teamMemberModel: Model<TeamMemberDocument>,
  pairs: Array<{ teamId: string; userId: string }>,
): Promise<Set<string>> {
  const teamIds = toUniqueObjectIds(pairs.map((pair) => pair.teamId));
  const userIds = toUniqueObjectIds(pairs.map((pair) => pair.userId));
  if (!teamIds.length || !userIds.length) {
    return new Set();
  }

  const docs = await teamMemberModel
    .find({
      team: { $in: teamIds },
      user: { $in: userIds },
      status: TeamMemberStatus.ACTIVE,
    })
    .select('team user')
    .lean();

  return new Set(
    docs.map((doc) => `${resolveId(doc.team)}:${resolveId(doc.user)}`),
  );
}

async function activeTeamIdsByUserIds(
  teamMemberModel: Model<TeamMemberDocument>,
  userIds: string[],
): Promise<Map<string, Set<string>>> {
  const objectIds = toUniqueObjectIds(userIds);
  const result = new Map<string, Set<string>>();
  if (!objectIds.length) {
    return result;
  }

  const docs = await teamMemberModel
    .find({
      user: { $in: objectIds },
      status: TeamMemberStatus.ACTIVE,
    })
    .select('team user')
    .lean();

  for (const doc of docs) {
    const userId = resolveId(doc.user);
    const teamId = resolveId(doc.team);
    const teams = result.get(userId) ?? new Set<string>();
    teams.add(teamId);
    result.set(userId, teams);
  }
  return result;
}

function toUniqueObjectIds(ids: string[]): Types.ObjectId[] {
  const unique = new Set<string>();
  const objectIds: Types.ObjectId[] = [];
  for (const id of ids) {
    if (!Types.ObjectId.isValid(id) || unique.has(id)) {
      continue;
    }
    unique.add(id);
    objectIds.push(new Types.ObjectId(id));
  }
  return objectIds;
}
