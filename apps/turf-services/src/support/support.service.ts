import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '../auth/decorators/roles.decorator';
import { PaginatedResult } from '../core/interfaces/common';
import { resolveId } from '../core/utils/mongo-ref.util';
import {
  AddSupportInternalNoteDto,
  AddSupportReplyDto,
  CreateSupportQueryDto,
  SupportQueryFilterDto,
  UpdateSupportQueryStatusDto,
} from './dto/support.dto';
import {
  SupportQueryStatus,
  SupportReplyAuthorRole,
} from './interfaces/support.interface';
import {
  SupportQuery,
  SupportQueryDocument,
} from './schemas/support-query.schema';
import { NotificationService } from '../notification/notification.service';
import {
  notifySupportAdminReply,
  notifySupportStatusChanged,
} from './utility/support-notification.utility';

const SUPPORT_USER_SELECT = '_id fullName avatar email phone role';

@Injectable()
export class SupportService {
  private static readonly populateOptions = [
    { path: 'userId', select: SUPPORT_USER_SELECT },
    { path: 'resolvedBy', select: SUPPORT_USER_SELECT },
    { path: 'replies.authorId', select: SUPPORT_USER_SELECT },
    { path: 'internalNotes.authorId', select: SUPPORT_USER_SELECT },
  ];

  constructor(
    @InjectModel(SupportQuery.name)
    private readonly supportQueryModel: Model<SupportQueryDocument>,
    private readonly notificationService: NotificationService,
  ) {}

  private toQueryResponse(
    doc: SupportQueryDocument,
    options: { includeInternalNotes?: boolean } = {},
  ) {
    const plain = doc.toObject();
    if (options.includeInternalNotes) {
      return plain;
    }
    const { internalNotes: _omitNotes, ...rest } = plain;
    return rest;
  }

  private isPlatformAdmin(role: string) {
    return role === UserRole.PLATFORM_ADMIN;
  }

  private assertCanAccess(
    query: SupportQueryDocument,
    userId: string,
    userRole: string,
  ) {
    const ownerId = resolveId(query.userId);
    if (ownerId !== userId && !this.isPlatformAdmin(userRole)) {
      throw new ForbiddenException('Access denied');
    }
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async createQuery(userId: string, dto: CreateSupportQueryDto) {
    const created = await this.supportQueryModel.create({
      userId,
      email: dto.email,
      phone: dto.phone,
      subject: dto.subject,
      message: dto.message,
      status: SupportQueryStatus.OPEN,
      replies: [],
      internalNotes: [],
    });

    const populated = (await created.populate(
      SupportService.populateOptions,
    )) as SupportQueryDocument;

    return this.toQueryResponse(populated);
  }

  async listMine(
    userId: string,
    filter: SupportQueryFilterDto,
  ): Promise<PaginatedResult<ReturnType<SupportService['toQueryResponse']>>> {
    const { status, page = 1, limit = 20 } = filter;
    const query: Record<string, unknown> = { userId };
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    const [data, totalDocuments] = await Promise.all([
      this.supportQueryModel
        .find(query)
        .populate(SupportService.populateOptions)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.supportQueryModel.countDocuments(query),
    ]);

    return {
      data: data.map((doc) => this.toQueryResponse(doc)),
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async listAll(
    filter: SupportQueryFilterDto,
  ): Promise<PaginatedResult<ReturnType<SupportService['toQueryResponse']>>> {
    const { status, userId, query: search, page = 1, limit = 20 } = filter;
    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    if (userId) query.userId = userId;
    if (search) {
      const rx = new RegExp(this.escapeRegex(search), 'i');
      query.$or = [{ subject: rx }, { email: rx }, { phone: rx }];
    }

    const skip = (page - 1) * limit;
    const [data, totalDocuments] = await Promise.all([
      this.supportQueryModel
        .find(query)
        .populate(SupportService.populateOptions)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.supportQueryModel.countDocuments(query),
    ]);

    return {
      data: data.map((doc) =>
        this.toQueryResponse(doc, { includeInternalNotes: true }),
      ),
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async getById(queryId: string, userId: string, userRole: string) {
    const query = await this.supportQueryModel
      .findById(queryId)
      .populate(SupportService.populateOptions);

    if (!query) {
      throw new NotFoundException('Support query not found');
    }

    this.assertCanAccess(query, userId, userRole);

    return this.toQueryResponse(query, {
      includeInternalNotes: this.isPlatformAdmin(userRole),
    });
  }

  async addReply(
    queryId: string,
    userId: string,
    userRole: string,
    dto: AddSupportReplyDto,
  ) {
    const query = await this.supportQueryModel.findById(queryId);
    if (!query) {
      throw new NotFoundException('Support query not found');
    }

    this.assertCanAccess(query, userId, userRole);

    const isAdmin = this.isPlatformAdmin(userRole);
    if (query.status === SupportQueryStatus.RESOLVED) {
      throw new BadRequestException(
        isAdmin
          ? 'Reopen the query before adding a reply'
          : 'This query has been resolved',
      );
    }

    query.replies.push({
      authorId: new Types.ObjectId(userId),
      authorRole: isAdmin
        ? SupportReplyAuthorRole.PLATFORM_ADMIN
        : SupportReplyAuthorRole.USER,
      body: dto.body,
      createdAt: new Date(),
    });

    if (isAdmin && query.status === SupportQueryStatus.OPEN) {
      query.status = SupportQueryStatus.IN_PROGRESS;
    }
    if (!isAdmin && query.status === SupportQueryStatus.IN_PROGRESS) {
      query.status = SupportQueryStatus.OPEN;
    }

    await query.save();

    if (isAdmin) {
      await notifySupportAdminReply(this.notificationService, {
        recipientUserId: resolveId(query.userId),
        queryId: query._id.toString(),
        subject: query.subject,
        replyBody: dto.body,
      });
    }

    const populated = (await query.populate(
      SupportService.populateOptions,
    )) as SupportQueryDocument;

    return this.toQueryResponse(populated, {
      includeInternalNotes: isAdmin,
    });
  }

  async addInternalNote(
    queryId: string,
    adminUserId: string,
    dto: AddSupportInternalNoteDto,
  ) {
    const query = await this.supportQueryModel.findById(queryId);
    if (!query) {
      throw new NotFoundException('Support query not found');
    }

    query.internalNotes.push({
      authorId: new Types.ObjectId(adminUserId),
      body: dto.body,
      createdAt: new Date(),
    });
    await query.save();

    const populated = (await query.populate(
      SupportService.populateOptions,
    )) as SupportQueryDocument;

    return this.toQueryResponse(populated, { includeInternalNotes: true });
  }

  async updateStatus(
    queryId: string,
    adminUserId: string,
    dto: UpdateSupportQueryStatusDto,
  ) {
    const query = await this.supportQueryModel.findById(queryId);
    if (!query) {
      throw new NotFoundException('Support query not found');
    }

    const previousStatus = query.status;
    query.status = dto.status;
    if (dto.status === SupportQueryStatus.RESOLVED) {
      query.resolvedBy = new Types.ObjectId(adminUserId);
      query.resolvedAt = new Date();
    } else {
      query.resolvedBy = undefined;
      query.resolvedAt = undefined;
    }

    await query.save();

    if (previousStatus !== dto.status) {
      await notifySupportStatusChanged(this.notificationService, {
        recipientUserId: resolveId(query.userId),
        queryId: query._id.toString(),
        subject: query.subject,
        status: dto.status,
      });
    }

    const populated = (await query.populate(
      SupportService.populateOptions,
    )) as SupportQueryDocument;

    return this.toQueryResponse(populated, { includeInternalNotes: true });
  }
}
