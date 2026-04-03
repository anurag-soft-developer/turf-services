import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Connection,
  ConnectionDocument,
  ConnectionStatus,
} from './schemas/connection.schema';
import { ConnectionFilterDto, SendConnectionRequestDto } from './dto/connection.dto';
import { PaginatedResult } from '../core/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';

const REJECTED_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ConnectionsService {
  static readonly userPopulate = [
    { path: 'requester', select: userSelectFields },
    { path: 'recipient', select: userSelectFields },
  ];

  constructor(
    @InjectModel(Connection.name)
    private connectionModel: Model<ConnectionDocument>,
  ) {}

  async sendRequest(
    userId: string,
    dto: SendConnectionRequestDto,
  ): Promise<ConnectionDocument> {
    if (dto.recipientId === userId) {
      throw new BadRequestException('Cannot connect with yourself');
    }

    const recipientOid = new Types.ObjectId(dto.recipientId);

    const existingSame = await this.connectionModel.findOne({
      requester: userId,
      recipient: recipientOid,
    });

    if (existingSame) {
      if (existingSame.status === ConnectionStatus.PENDING) {
        throw new ConflictException('Connection request already sent');
      }
      if (existingSame.status === ConnectionStatus.ACCEPTED) {
        throw new ConflictException('Already connected');
      }
      if (existingSame.status === ConnectionStatus.REJECTED) {
        throw new ConflictException(
          'Request was rejected; try again after the record expires',
        );
      }
    }

    const reverse = await this.connectionModel.findOne({
      requester: recipientOid,
      recipient: userId,
    });

    if (reverse) {
      if (reverse.status === ConnectionStatus.PENDING) {
        throw new ConflictException(
          'This user has already sent you a request; accept or reject it',
        );
      }
      if (reverse.status === ConnectionStatus.ACCEPTED) {
        throw new ConflictException('Already connected');
      }
    }

    const doc = await this.connectionModel.create({
      requester: userId,
      recipient: recipientOid,
      status: ConnectionStatus.PENDING,
    });

    return (await doc.populate(ConnectionsService.userPopulate)) as ConnectionDocument;
  }

  async resolveRequest(
    connectionId: string,
    userId: string,
    status: ConnectionStatus.ACCEPTED | ConnectionStatus.REJECTED,
  ): Promise<ConnectionDocument> {
    const conn = await this.connectionModel.findById(connectionId);
    if (!conn) {
      throw new NotFoundException('Connection request not found');
    }

    if (conn.recipient.toString() !== userId) {
      throw new ForbiddenException('Only the recipient can resolve this request');
    }

    if (conn.status !== ConnectionStatus.PENDING) {
      throw new BadRequestException('Request is no longer pending');
    }

    if (status === ConnectionStatus.ACCEPTED) {
      conn.status = ConnectionStatus.ACCEPTED;
      conn.purgeAt = undefined;
    } else {
      conn.status = ConnectionStatus.REJECTED;
      conn.purgeAt = new Date(Date.now() + REJECTED_TTL_MS);
    }

    await conn.save();

    return (await conn.populate(ConnectionsService.userPopulate)) as ConnectionDocument;
  }


  async closeConnection(connectionId: string, userId: string): Promise<void> {
    const conn = await this.connectionModel.findById(connectionId);
    if (!conn) {
      throw new NotFoundException('Connection not found');
    }

    const isParticipant =
      conn.requester.toString() === userId ||
      conn.recipient.toString() === userId;

    if (!isParticipant) {
      throw new ForbiddenException('Not a participant in this connection');
    }

    // if (conn.status !== ConnectionStatus.ACCEPTED) {
    //   throw new BadRequestException('Only accepted connections can be closed');
    // }

    await this.connectionModel.findByIdAndDelete(connectionId);
  }

  async listMine(
    userId: string,
    filter: ConnectionFilterDto,
  ): Promise<PaginatedResult<ConnectionDocument>> {
    const {
      status,
      direction = 'all',
      page = 1,
      limit = 20,
    } = filter;

    const uid = new Types.ObjectId(userId);
    const base: Record<string, unknown> = {};

    if (status) {
      base.status = status;
    }

    let filterQuery: Record<string, unknown> = {};

    if (direction === 'incoming') {
      filterQuery = { ...base, recipient: uid };
    } else if (direction === 'outgoing') {
      filterQuery = { ...base, requester: uid };
    } else {
      filterQuery = {
        ...base,
        $or: [{ requester: uid }, { recipient: uid }],
      };
    }

    const skip = (page - 1) * limit;

    const [data, totalDocuments] = await Promise.all([
      this.connectionModel
        .find(filterQuery)
        .populate(ConnectionsService.userPopulate)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.connectionModel.countDocuments(filterQuery),
    ]);

    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async areConnected(userIdA: string, userIdB: string): Promise<boolean> {
    if (userIdA === userIdB) {
      return true;
    }

    const a = new Types.ObjectId(userIdA);
    const b = new Types.ObjectId(userIdB);

    const found = await this.connectionModel.exists({
      status: ConnectionStatus.ACCEPTED,
      $or: [
        { requester: a, recipient: b },
        { requester: b, recipient: a },
      ],
    });

    return !!found;
  }

  async isConnectedToAny(
    userId: string,
    otherUserIds: Types.ObjectId[],
  ): Promise<boolean> {
    if (!otherUserIds.length) {
      return false;
    }

    const uid = new Types.ObjectId(userId);
    const found = await this.connectionModel.exists({
      status: ConnectionStatus.ACCEPTED,
      $or: [
        { requester: uid, recipient: { $in: otherUserIds } },
        { recipient: uid, requester: { $in: otherUserIds } },
      ],
    });

    return !!found;
  }

  async findById(id: string): Promise<ConnectionDocument | null> {
    return this.connectionModel
      .findById(id)
      .populate(ConnectionsService.userPopulate)
      .exec();
  }
}
