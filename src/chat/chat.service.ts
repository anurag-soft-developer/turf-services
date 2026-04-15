import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model } from 'mongoose';
import {
  BatchPersistChatMessage,
  ChatHistoryQuery,
  ChatMessage as SharedChatMessage,
  ChatScope,
  normalizePlayerScopeId,
} from '../package';
import { ChatMessage, ChatMessageDocument } from './schemas/chat-message.schema';
import { TeamMemberService } from '../team-member/team-member.service';
import { TeamMatch, TeamMatchDocument } from '../matchmaking/schemas/team-match.schema';

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
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    private readonly teamMemberService: TeamMemberService,
  ) {}

  async batchPersistMessages(
    messages: BatchPersistChatMessage[],
  ): Promise<BatchPersistResult> {
    const failedMessageIds: string[] = [];
    const operations: AnyBulkWriteOperation<ChatMessageDocument>[] = [];

    for (const message of messages) {
      try {
        await this.assertScopeAccess(message.senderUserId, message.scope, message.scopeId);

        operations.push({
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
        });
      } catch {
        failedMessageIds.push(message.messageId);
      }
    }

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
    await this.assertScopeAccess(viewerUserId, query.scope, query.scopeId);

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

  private async assertScopeAccess(
    userId: string,
    scope: ChatScope,
    scopeId: string,
  ): Promise<void> {
    if (scope === 'team') {
      const isMember = await this.teamMemberService.hasActiveMembership(scopeId, userId);
      if (!isMember) {
        throw new ForbiddenException('User is not an active member of this team');
      }
      return;
    }

    if (scope === 'match') {
      const match = await this.teamMatchModel.findById(scopeId).lean();
      if (!match) {
        throw new NotFoundException('Match not found');
      }

      const activeTeamIds = await this.teamMemberService.distinctActiveTeamIds(userId);
      const activeSet = new Set(activeTeamIds.map((id) => id.toString()));
      const isRelated =
        activeSet.has(match.fromTeam.toString()) || activeSet.has(match.toTeam.toString());

      if (!isRelated) {
        throw new ForbiddenException('User is not part of this match');
      }
      return;
    }

    const participants = scopeId.split(':').filter(Boolean);
    if (participants.length !== 2) {
      throw new BadRequestException('Invalid player scopeId format');
    }

    if (!participants.includes(userId)) {
      throw new ForbiddenException('User is not a participant in this player chat');
    }

    const normalized = normalizePlayerScopeId(participants[0], participants[1]);
    if (normalized !== scopeId) {
      throw new BadRequestException('Player scopeId is not normalized');
    }
  }
}
