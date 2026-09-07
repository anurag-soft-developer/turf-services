import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model, PipelineStage } from 'mongoose';
import {
  BatchPersistChatMessage,
  ChatAccessResponse,
  ChatHideResult,
  ChatHistoryQuery,
  ChatInboxQuery,
  ChatInboxUpdatedEvent,
  ChatMessage as SharedChatMessage,
  ChatMessageDeletedEvent,
  ChatReadCursor as SharedChatReadCursor,
  ChatReadEvent,
  ChatRef,
  ChatScope,
  type DeleteChatMessageInternal,
  uniqueChatRefs,
} from '../../../../libs';
import {
  ChatMessage,
  ChatMessageDocument,
} from './schemas/chat-message.schema';
import {
  ChatReadCursor,
  ChatReadCursorDocument,
} from './schemas/chat-read-cursor.schema';
import { TeamMemberService } from '../team-member/team-member.service';
import {
  TeamMember,
  TeamMemberDocument,
} from '../team-member/schemas/team-member.schema';
import {
  TeamMatch,
  TeamMatchDocument,
} from '../matchmaking/schemas/team-match.schema';
import { Team, TeamDocument } from '../team/schemas/team.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  assertScopeAccess,
  listChatParticipantUserIds,
  resolvePersistableMessages,
} from './utility/chat-access.utility';
import {
  buildInboxMatchStage,
  buildInboxTitleSearchMatch,
  GroupedInboxRow,
  hydrateInboxItems,
  inboxHideFilterStages,
} from './utility/chat.utility';

export interface BatchPersistResult {
  insertedCount: number;
  duplicateCount: number;
  failedMessageIds: string[];
}

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(ChatReadCursor.name)
    private readonly chatReadCursorModel: Model<ChatReadCursorDocument>,
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly teamMemberService: TeamMemberService,
  ) {}

  async batchPersistMessages(
    messages: BatchPersistChatMessage[],
  ): Promise<BatchPersistResult> {
    const { allowedMessages, failedMessageIds } =
      await resolvePersistableMessages(
        messages,
        this.teamMemberModel,
        this.teamMatchModel,
      );
    const operations: AnyBulkWriteOperation<ChatMessageDocument>[] =
      allowedMessages.map((message) => ({
        updateOne: {
          filter: { idempotencyKey: message.idempotencyKey },
          update: {
            $setOnInsert: {
              scope: message.scope,
              scopeId: message.scopeId,
              senderUserId: message.senderUserId,
              body: message.body,
              messageId: message.messageId,
              idempotencyKey: message.idempotencyKey,
              messageCreatedAt: new Date(message.createdAt),
            },
          },
          upsert: true,
        },
      }));

    if (!operations.length) {
      return {
        insertedCount: 0,
        duplicateCount: 0,
        failedMessageIds,
      };
    }

    const result = await this.chatMessageModel.bulkWrite(operations, {
      ordered: false,
    });
    const insertedCount = result.upsertedCount ?? 0;
    const attemptedCount = operations.length;
    const duplicateCount = attemptedCount - insertedCount;

    return {
      insertedCount,
      duplicateCount,
      failedMessageIds,
    };
  }

  async listMessages(
    viewerUserId: string,
    query: ChatHistoryQuery,
  ): Promise<SharedChatMessage[]> {
    await assertScopeAccess(
      viewerUserId,
      query.scope,
      query.scopeId,
      this.teamMemberService,
      this.teamMatchModel,
    );

    const filter: Record<string, unknown> = {
      scope: query.scope,
      scopeId: query.scopeId,
      deletedAt: { $exists: false },
    };

    if (query.before) {
      filter.messageCreatedAt = { $lt: new Date(query.before) };
    }

    const docs = await this.chatMessageModel
      .find(filter)
      .sort({ messageCreatedAt: -1 })
      .limit(query.limit)
      .lean();

    return docs.map((doc) => ({
      messageId: doc.messageId,
      scope: doc.scope,
      scopeId: doc.scopeId,
      senderUserId: doc.senderUserId,
      body: doc.body,
      createdAt: doc.messageCreatedAt.toISOString(),
    }));
  }

  async deleteMessage(
    userId: string,
    input: Omit<DeleteChatMessageInternal, 'userId'>,
  ): Promise<ChatMessageDeletedEvent> {
    await assertScopeAccess(
      userId,
      input.scope,
      input.scopeId,
      this.teamMemberService,
      this.teamMatchModel,
    );

    const existing = await this.chatMessageModel
      .findOne({ messageId: input.messageId })
      .lean();

    if (existing) {
      if (existing.senderUserId !== userId) {
        throw new ForbiddenException('You can only delete your own messages');
      }
      if (
        existing.scope !== input.scope ||
        existing.scopeId !== input.scopeId
      ) {
        throw new BadRequestException('Message does not belong to this thread');
      }
      if (!existing.deletedAt) {
        await this.chatMessageModel.updateOne(
          { messageId: input.messageId },
          { $set: { deletedAt: new Date() } },
        );
      }
    } else {
      await this.insertDeletedTombstone(userId, input);
    }

    const deletedAt =
      existing?.deletedAt?.toISOString() ?? new Date().toISOString();
    return {
      messageId: input.messageId,
      scope: input.scope,
      scopeId: input.scopeId,
      deletedAt,
      inboxUpdated: await this.latestInboxUpdated(input.scope, input.scopeId),
    };
  }

  private async insertDeletedTombstone(
    userId: string,
    input: Omit<DeleteChatMessageInternal, 'userId'>,
  ): Promise<void> {
    if (!input.body || !input.createdAt) {
      throw new NotFoundException('Message not found');
    }

    try {
      await this.chatMessageModel.create({
        scope: input.scope,
        scopeId: input.scopeId,
        senderUserId: userId,
        body: input.body,
        messageId: input.messageId,
        idempotencyKey: `${input.messageId}:${userId}`,
        messageCreatedAt: new Date(input.createdAt),
        deletedAt: new Date(),
      });
    } catch (error: unknown) {
      const code = (error as { code?: number }).code;
      if (code !== 11000) {
        throw error;
      }
      const raced = await this.chatMessageModel
        .findOne({ messageId: input.messageId })
        .lean();
      if (!raced) {
        throw error;
      }
      if (raced.senderUserId !== userId) {
        throw new ForbiddenException('You can only delete your own messages');
      }
      if (raced.scope !== input.scope || raced.scopeId !== input.scopeId) {
        throw new BadRequestException('Message does not belong to this thread');
      }
      if (!raced.deletedAt) {
        await this.chatMessageModel.updateOne(
          { messageId: input.messageId },
          { $set: { deletedAt: new Date() } },
        );
      }
    }
  }

  private async latestInboxUpdated(
    scope: ChatScope,
    scopeId: string,
  ): Promise<ChatInboxUpdatedEvent | null> {
    const last = await this.chatMessageModel
      .findOne({
        scope,
        scopeId,
        deletedAt: { $exists: false },
      })
      .sort({ messageCreatedAt: -1 })
      .lean();
    if (!last) {
      return null;
    }
    return {
      scope: last.scope,
      scopeId: last.scopeId,
      lastMessageId: last.messageId,
      lastMessageBody: last.body,
      lastSenderUserId: last.senderUserId,
      lastMessageAt: last.messageCreatedAt.toISOString(),
    };
  }

  async listInbox(viewerUserId: string, query: ChatInboxQuery) {
    const viewerId = String(viewerUserId);
    const matchStage = await buildInboxMatchStage(
      viewerId,
      this.teamMemberService,
      this.teamMatchModel,
    );
    const skip = (query.page - 1) * query.limit;
    const groupedStages: PipelineStage[] = [
      { $match: matchStage },
      { $sort: { messageCreatedAt: -1 } },
      {
        $group: {
          _id: { scope: '$scope', scopeId: '$scopeId' },
          lastMessageId: { $first: '$messageId' },
          lastMessageBody: { $first: '$body' },
          lastSenderUserId: { $first: '$senderUserId' },
          lastMessageAt: { $first: '$messageCreatedAt' },
        },
      },
      ...inboxHideFilterStages(viewerId),
    ];

    const search = query.search?.trim();
    if (search) {
      const titleMatch = await buildInboxTitleSearchMatch(
        viewerId,
        search,
        this.teamModel,
        this.userModel,
      );
      if (!titleMatch) {
        return {
          data: [],
          totalDocuments: 0,
          page: query.page,
          limit: query.limit,
          totalPages: 0,
        };
      }
      groupedStages.push({ $match: titleMatch });
    }

    const [grouped, countResult] = await Promise.all([
      this.chatMessageModel.aggregate<GroupedInboxRow>([
        ...groupedStages,
        { $sort: { lastMessageAt: -1 } },
        { $skip: skip },
        { $limit: query.limit },
      ]),
      this.chatMessageModel.aggregate<{ total: number }>([
        ...groupedStages,
        { $count: 'total' },
      ]),
    ]);

    const totalDocuments = countResult[0]?.total ?? 0;
    const data = await hydrateInboxItems(
      viewerId,
      grouped,
      this.chatReadCursorModel,
      this.chatMessageModel,
      this.teamMatchModel,
      this.teamModel,
      this.userModel,
    );

    return {
      data,
      totalDocuments,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(totalDocuments / query.limit) || 0,
    };
  }

  async markRead(userId: string, ref: ChatRef): Promise<ChatReadEvent> {
    await assertScopeAccess(
      userId,
      ref.scope,
      ref.scopeId,
      this.teamMemberService,
      this.teamMatchModel,
    );
    const lastReadAt = new Date();
    await this.chatReadCursorModel.updateOne(
      { userId, scope: ref.scope, scopeId: ref.scopeId },
      { $set: { lastReadAt }, $unset: { hiddenAt: 1 } },
      { upsert: true },
    );
    return {
      scope: ref.scope,
      scopeId: ref.scopeId,
      userId,
      lastReadAt: lastReadAt.toISOString(),
    };
  }

  async hideThreads(userId: string, refs: ChatRef[]): Promise<ChatHideResult> {
    const uniqueRefs = uniqueChatRefs(refs);
    if (!uniqueRefs.length) {
      throw new BadRequestException('Provide at least one thread to hide');
    }
    const hiddenAt = new Date();
    const operations: AnyBulkWriteOperation<ChatReadCursorDocument>[] =
      uniqueRefs.map((ref) => ({
        updateOne: {
          filter: { userId, scope: ref.scope, scopeId: ref.scopeId },
          update: { $set: { lastReadAt: hiddenAt, hiddenAt } },
          upsert: true,
        },
      }));
    await this.chatReadCursorModel.bulkWrite(operations, { ordered: false });
    return {
      items: uniqueRefs.map((ref) => ({
        scope: ref.scope,
        scopeId: ref.scopeId,
        hiddenAt: hiddenAt.toISOString(),
      })),
    };
  }

  async listReadCursors(
    viewerUserId: string,
    ref: ChatRef,
  ): Promise<SharedChatReadCursor[]> {
    await assertScopeAccess(
      viewerUserId,
      ref.scope,
      ref.scopeId,
      this.teamMemberService,
      this.teamMatchModel,
    );
    const participantUserIds = await this.listParticipantUserIds(
      ref.scope,
      ref.scopeId,
    );
    if (!participantUserIds.length) {
      return [];
    }
    const docs = await this.chatReadCursorModel
      .find({
        scope: ref.scope,
        scopeId: ref.scopeId,
        userId: { $in: participantUserIds },
      })
      .lean();
    return docs.map((doc) => ({
      userId: doc.userId,
      lastReadAt: doc.lastReadAt.toISOString(),
    }));
  }

  async assertAccess(
    userId: string,
    ref: ChatRef,
  ): Promise<ChatAccessResponse> {
    await assertScopeAccess(
      userId,
      ref.scope,
      ref.scopeId,
      this.teamMemberService,
      this.teamMatchModel,
    );
    const participantUserIds = await this.listParticipantUserIds(
      ref.scope,
      ref.scopeId,
    );
    return { ok: true, participantUserIds };
  }

  async listParticipantUserIds(
    scope: ChatScope,
    scopeId: string,
  ): Promise<string[]> {
    return listChatParticipantUserIds(
      scope,
      scopeId,
      this.teamMemberService,
      this.teamMatchModel,
    );
  }
}
