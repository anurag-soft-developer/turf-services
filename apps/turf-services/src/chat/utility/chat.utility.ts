import { Model, PipelineStage, Types } from 'mongoose';
import {
  ChatInboxItem,
  ChatScope,
  getOtherPlayerId,
} from '../../../../../libs';
import { TeamMemberService } from '../../team-member/team-member.service';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { TeamDocument } from '../../team/schemas/team.schema';
import { UserDocument } from '../../users/schemas/user.schema';
import { ChatMessageDocument } from '../schemas/chat-message.schema';
import { ChatReadCursorDocument } from '../schemas/chat-read-cursor.schema';
import { resolveId } from '../../core/utils/mongo-ref.util';

export type GroupedInboxRow = {
  _id: { scope: ChatScope; scopeId: string };
  lastMessageId: string;
  lastMessageBody: string;
  lastSenderUserId: string;
  lastMessageAt: Date;
};

export async function buildInboxMatchStage(
  viewerId: string,
  teamMemberService: TeamMemberService,
  teamMatchModel: Model<TeamMatchDocument>,
): Promise<Record<string, unknown>> {
  const myTeamIds = await teamMemberService.distinctActiveTeamIds(viewerId);
  const teamIdStrings = myTeamIds.map((id) => id.toString());

  const matchIds = myTeamIds.length
    ? await teamMatchModel.distinct('_id', {
        $or: [
          { fromTeam: { $in: myTeamIds } },
          { toTeam: { $in: myTeamIds } },
        ],
      })
    : [];
  const matchIdStrings = matchIds.map((id) => id.toString());

  const orFilters: Record<string, unknown>[] = [];
  if (teamIdStrings.length) {
    orFilters.push({ scope: 'team', scopeId: { $in: teamIdStrings } });
  }
  if (matchIdStrings.length) {
    orFilters.push({ scope: 'match', scopeId: { $in: matchIdStrings } });
  }
  orFilters.push({
    scope: 'player',
    $or: [
      { scopeId: { $regex: `^${escapeRegex(viewerId)}:` } },
      { scopeId: { $regex: `:${escapeRegex(viewerId)}$` } },
    ],
  });

  return {
    deletedAt: { $exists: false },
    $or: orFilters,
  };
}

const CHAT_READ_CURSORS_COLLECTION = 'chat-read-cursors';

/** Drop rooms the viewer hid, unless a newer message arrived after `hiddenAt`. */
export function inboxHideFilterStages(viewerId: string): PipelineStage[] {
  return [
    {
      $lookup: {
        from: CHAT_READ_CURSORS_COLLECTION,
        let: { scope: '$_id.scope', scopeId: '$_id.scopeId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$userId', viewerId] },
                  { $eq: ['$scope', '$$scope'] },
                  { $eq: ['$scopeId', '$$scopeId'] },
                ],
              },
            },
          },
          { $project: { hiddenAt: 1 } },
        ],
        as: '_viewerCursor',
      },
    },
    {
      $match: {
        $expr: {
          $or: [
            {
              $eq: [
                {
                  $ifNull: [
                    { $arrayElemAt: ['$_viewerCursor.hiddenAt', 0] },
                    null,
                  ],
                },
                null,
              ],
            },
            {
              $gt: [
                '$lastMessageAt',
                { $arrayElemAt: ['$_viewerCursor.hiddenAt', 0] },
              ],
            },
          ],
        },
      },
    },
    { $unset: '_viewerCursor' },
  ];
}

export async function hydrateInboxItems(
  viewerId: string,
  grouped: GroupedInboxRow[],
  chatReadCursorModel: Model<ChatReadCursorDocument>,
  chatMessageModel: Model<ChatMessageDocument>,
  teamMatchModel: Model<TeamMatchDocument>,
  teamModel: Model<TeamDocument>,
  userModel: Model<UserDocument>,
): Promise<ChatInboxItem[]> {
  if (!grouped.length) {
    return [];
  }

  const cursors = await chatReadCursorModel
    .find({
      userId: viewerId,
      $or: grouped.map((row) => ({
        scope: row._id.scope,
        scopeId: row._id.scopeId,
      })),
    })
    .lean();
  const cursorMap = new Map(
    cursors.map((doc) => [`${doc.scope}:${doc.scopeId}`, doc.lastReadAt]),
  );

  const unreadCounts = await Promise.all(
    grouped.map(async (row) => {
      const lastReadAt = cursorMap.get(`${row._id.scope}:${row._id.scopeId}`);
      const filter: Record<string, unknown> = {
        scope: row._id.scope,
        scopeId: row._id.scopeId,
        deletedAt: { $exists: false },
      };
      if (lastReadAt) {
        filter.messageCreatedAt = { $gt: lastReadAt };
      }
      return chatMessageModel.countDocuments(filter);
    }),
  );

  const titles = await resolveInboxTitles(
    viewerId,
    grouped,
    teamMatchModel,
    teamModel,
    userModel,
  );

  return grouped.map((row, index) => {
    const title = titles.get(`${row._id.scope}:${row._id.scopeId}`);
    return {
      scope: row._id.scope,
      scopeId: row._id.scopeId,
      title: title?.title ?? fallbackTitle(row._id.scope),
      imageUrl: title?.imageUrl,
      lastMessageId: row.lastMessageId,
      lastMessageBody: row.lastMessageBody,
      lastSenderUserId: row.lastSenderUserId,
      lastMessageAt: row.lastMessageAt.toISOString(),
      unreadCount: unreadCounts[index] ?? 0,
    };
  });
}

async function resolveInboxTitles(
  viewerId: string,
  grouped: GroupedInboxRow[],
  teamMatchModel: Model<TeamMatchDocument>,
  teamModel: Model<TeamDocument>,
  userModel: Model<UserDocument>,
): Promise<Map<string, { title: string; imageUrl?: string }>> {
  const result = new Map<string, { title: string; imageUrl?: string }>();
  const playerIds = new Set<string>();
  const teamIds = new Set<string>();
  const matchIds: string[] = [];

  for (const row of grouped) {
    if (row._id.scope === 'player') {
      const otherId = getOtherPlayerId(row._id.scopeId, viewerId);
      if (otherId) {
        playerIds.add(otherId);
      }
    } else if (row._id.scope === 'team') {
      teamIds.add(row._id.scopeId);
    } else {
      matchIds.push(row._id.scopeId);
    }
  }

  const matches = matchIds.length
    ? await teamMatchModel
        .find({
          _id: {
            $in: matchIds
              .filter((id) => Types.ObjectId.isValid(id))
              .map((id) => new Types.ObjectId(id)),
          },
        })
        .select('fromTeam toTeam')
        .lean()
    : [];

  for (const match of matches) {
    teamIds.add(resolveId(match.fromTeam));
    teamIds.add(resolveId(match.toTeam));
  }

  const validTeamObjectIds = [...teamIds]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  const validUserObjectIds = [...playerIds]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  const [teams, users] = await Promise.all([
    validTeamObjectIds.length
      ? teamModel
          .find({ _id: { $in: validTeamObjectIds } })
          .select('name logo')
          .lean()
      : [],
    validUserObjectIds.length
      ? userModel
          .find({ _id: { $in: validUserObjectIds } })
          .select('fullName avatar')
          .lean()
      : [],
  ]);

  type InboxTitle = { title: string; imageUrl?: string };

  const teamById = new Map<string, InboxTitle>(
    teams.map((team): [string, InboxTitle] => [
      String(team._id),
      {
        title: team.name?.trim() || 'Team',
        imageUrl: team.logo || undefined,
      },
    ]),
  );
  const userById = new Map<string, InboxTitle>(
    users.map((user): [string, InboxTitle] => [
      String(user._id),
      {
        title: user.fullName?.trim() || 'Player',
        imageUrl: user.avatar || undefined,
      },
    ]),
  );
  const matchById = new Map<string, InboxTitle>(
    matches.map((match): [string, InboxTitle] => {
      const from = teamById.get(resolveId(match.fromTeam));
      const to = teamById.get(resolveId(match.toTeam));
      return [
        match._id.toString(),
        {
          title: `${from?.title ?? 'Team'} vs ${to?.title ?? 'Team'}`,
          imageUrl: from?.imageUrl ?? to?.imageUrl,
        },
      ];
    }),
  );

  for (const row of grouped) {
    const key = `${row._id.scope}:${row._id.scopeId}`;
    if (row._id.scope === 'player') {
      const otherId = getOtherPlayerId(row._id.scopeId, viewerId);
      if (otherId && userById.has(otherId)) {
        result.set(key, userById.get(otherId)!);
      }
      continue;
    }
    if (row._id.scope === 'team' && teamById.has(row._id.scopeId)) {
      result.set(key, teamById.get(row._id.scopeId)!);
      continue;
    }
    if (row._id.scope === 'match' && matchById.has(row._id.scopeId)) {
      result.set(key, matchById.get(row._id.scopeId)!);
    }
  }

  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fallbackTitle(scope: ChatScope): string {
  if (scope === 'team') {
    return 'Team';
  }
  if (scope === 'match') {
    return 'Match';
  }
  return 'Chat';
}
