import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Withdrawal,
  WithdrawalDocument,
} from './schemas/withdrawal.schema';
import {
  AddWithdrawalAttachmentsDto,
  AddWithdrawalCommentDto,
  CreateWithdrawalRequestDto,
  UpdateWithdrawalStatusDto,
  WithdrawalFilterDto,
} from './dto/withdrawal.dto';
import { userSelectFields } from '../users/schemas/user.schema';
import { WithdrawalStatus } from './interfaces/withdrawal.interface';
import { WithdrawalUtility } from './utility/withdrawal.utility';
import { PaginatedResult } from '../core/interfaces/common';
import { resolveId } from '../core/utils/mongo-ref.util';
import { WalletService } from '../wallet/wallet.service';
import { WalletUtility } from '../wallet/utility/wallet.utility';
import { UserRole } from '../auth/decorators/roles.decorator';
import { NotificationService } from '../notification/notification.service';
import { UsersService } from '../users/users.service';
import {
  notifyWithdrawalStatusChanged,
  notifyWithdrawalSubmitted,
} from './utility/withdrawals-notification.utility';

@Injectable()
export class WithdrawalsService {
  private static readonly populateOptions = [
    { path: 'requestedBy', select: userSelectFields },
    { path: 'reviewedBy', select: userSelectFields },
    { path: 'comments.addedBy', select: userSelectFields },
  ];

  constructor(
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    private readonly walletService: WalletService,
    private readonly notificationService: NotificationService,
    private readonly usersService: UsersService,
  ) {}

  private toWithdrawalResponse(
    doc: WithdrawalDocument,
    options: { forHost?: boolean } = {},
  ) {
    const plain = doc.toObject();
    if (options.forHost) {
      const {
        payoutSnapshot: _omitPayoutSnapshot,
        comments: _omitComments,
        attachments: _omitAttachments,
        ...rest
      } = plain;
      return rest;
    }
    return plain;
  }

  async createRequest(
    userId: string,
    dto: CreateWithdrawalRequestDto,
  ) {
    const wallet = await this.walletService.getOrCreateWallet(userId);

    if (!WalletUtility.hasCompletePayoutDetails(wallet.payoutDetails)) {
      throw new BadRequestException(
        'Complete payout details required before requesting withdrawal',
      );
    }

    const reserved = await this.walletService.reserveWithdrawalHold(
      userId,
      dto.walletType,
      dto.amount,
    );
    if (!reserved) {
      throw new BadRequestException('Insufficient balance for withdrawal');
    }

    try {
      const created = await this.withdrawalModel.create({
        requestedBy: userId,
        walletType: dto.walletType,
        amount: dto.amount,
        status: WithdrawalStatus.PENDING,
        comments: [],
        attachments: [],
      });

      const populated = (await created.populate(
        WithdrawalsService.populateOptions,
      )) as WithdrawalDocument;

      await notifyWithdrawalSubmitted(this.notificationService, this.usersService, {
        withdrawalId: created._id.toString(),
        amount: dto.amount,
        walletType: dto.walletType,
        hostUserId: userId,
      });

      return this.toWithdrawalResponse(populated, { forHost: true });
    } catch (error) {
      await this.walletService.releaseWithdrawalHold(
        userId,
        dto.walletType,
        dto.amount,
      );
      throw error;
    }
  }

  async getById(
    withdrawalId: string,
    userId: string,
    userRole: string,
  ) {
    const request = await this.withdrawalModel
      .findById(withdrawalId)
      .populate(WithdrawalsService.populateOptions);

    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    const hostUserId = resolveId(request.requestedBy);
    const isOwner = hostUserId === userId;
    const isPlatformAdmin = userRole === UserRole.PLATFORM_ADMIN;

    if (!isOwner && !isPlatformAdmin) {
      throw new ForbiddenException('Access denied');
    }

    const response = this.toWithdrawalResponse(request, {
      forHost: isOwner && !isPlatformAdmin,
    });

    if (isPlatformAdmin) {
      const wallet = await this.walletService.getOrCreateWallet(hostUserId);
      return {
        ...response,
        hostPayoutDetails: wallet.payoutDetails,
      };
    }

    return response;
  }

  async cancelRequest(
    withdrawalId: string,
    userId: string,
  ) {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    if (resolveId(request.requestedBy) !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (request.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(
        'Only pending withdrawal requests can be cancelled',
      );
    }

    WithdrawalUtility.validateStatusTransition(
      request.status,
      WithdrawalStatus.CANCELLED,
    );

    request.status = WithdrawalStatus.CANCELLED;
    await request.save();

    await this.walletService.releaseWithdrawalHold(
      userId,
      request.walletType,
      request.amount,
    );

    const populated = (await request.populate(
      WithdrawalsService.populateOptions,
    )) as WithdrawalDocument;

    return this.toWithdrawalResponse(populated, { forHost: true });
  }

  async listMine(
    userId: string,
    filter: WithdrawalFilterDto,
  ): Promise<PaginatedResult<ReturnType<WithdrawalsService['toWithdrawalResponse']>>> {
    const { status, walletType, page = 1, limit = 20 } = filter;
    const query: Record<string, unknown> = { requestedBy: userId };
    if (status) query.status = status;
    if (walletType) query.walletType = walletType;

    const skip = (page - 1) * limit;
    const [data, totalDocuments] = await Promise.all([
      this.withdrawalModel
        .find(query)
        .populate(WithdrawalsService.populateOptions)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.withdrawalModel.countDocuments(query),
    ]);

    return {
      data: data.map((doc) => this.toWithdrawalResponse(doc, { forHost: true })),
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async listAll(
    filter: WithdrawalFilterDto,
  ): Promise<PaginatedResult<ReturnType<WithdrawalsService['toWithdrawalResponse']>>> {
    const { status, walletType, userId, page = 1, limit = 20 } = filter;
    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    if (walletType) query.walletType = walletType;
    if (userId) query.requestedBy = userId;

    const skip = (page - 1) * limit;
    const [data, totalDocuments] = await Promise.all([
      this.withdrawalModel
        .find(query)
        .populate(WithdrawalsService.populateOptions)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.withdrawalModel.countDocuments(query),
    ]);

    return {
      data: data.map((doc) => this.toWithdrawalResponse(doc)),
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async addComment(
    withdrawalId: string,
    userId: string,
    dto: AddWithdrawalCommentDto,
  ) {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    // if (WithdrawalUtility.isTerminalStatus(request.status)) {
    //   throw new BadRequestException(
    //     'Cannot add comment to a terminal withdrawal request',
    //   );
    // }

    request.comments.push({
      addedBy: new Types.ObjectId(userId),
      message: dto.message,
      createdAt: new Date(),
    });
    await request.save();

    const populated = (await request.populate(
      WithdrawalsService.populateOptions,
    )) as WithdrawalDocument;

    return this.toWithdrawalResponse(populated);
  }

  async addAttachments(
    withdrawalId: string,
    dto: AddWithdrawalAttachmentsDto,
  ) {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    // if (WithdrawalUtility.isTerminalStatus(request.status)) {
    //   throw new BadRequestException(
    //     'Cannot update attachments on a terminal withdrawal request',
    //   );
    // }

    const mergedAttachments = [...request.attachments, ...dto.attachments];
    if (mergedAttachments.length > 10) {
      throw new BadRequestException('A maximum of 10 attachments are allowed');
    }

    request.attachments = mergedAttachments;
    await request.save();

    const populated = (await request.populate(
      WithdrawalsService.populateOptions,
    )) as WithdrawalDocument;

    return this.toWithdrawalResponse(populated);
  }

  async updateStatus(
    withdrawalId: string,
    adminUserId: string,
    dto: UpdateWithdrawalStatusDto,
  ) {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    WithdrawalUtility.validateStatusTransition(request.status, dto.status);

    if (dto.status === WithdrawalStatus.REJECTED && !dto.rejectionReason) {
      throw new BadRequestException(
        'Rejection reason is required for rejected requests',
      );
    }

    if (
      dto.status === WithdrawalStatus.SETTLED &&
      request.status !== WithdrawalStatus.SETTLED
    ) {
      const hostUserId = resolveId(request.requestedBy);
      const wallet = await this.walletService.getOrCreateWallet(hostUserId);

      const payoutSnapshot = WalletUtility.buildPayoutSnapshotForMethod(
        wallet.payoutDetails,
        dto.paidViaMethod!,
      );

      if (!payoutSnapshot) {
        throw new BadRequestException(
          `Complete ${dto.paidViaMethod} payout details are not available for this host`,
        );
      }

      request.payoutSnapshot = payoutSnapshot;

      const settled = await this.walletService.settleWithdrawal(
        hostUserId,
        request.walletType,
        request.amount,
      );

      if (!settled) {
        throw new BadRequestException(
          'Insufficient user balance to settle withdrawal',
        );
      }

      request.processedAt = new Date();
    }

    const shouldReleaseHold =
      (dto.status === WithdrawalStatus.REJECTED ||
        dto.status === WithdrawalStatus.CANCELLED) &&
      !WithdrawalUtility.isTerminalStatus(request.status);

    request.status = dto.status;
    request.reviewedBy = new Types.ObjectId(adminUserId);
    request.reviewedAt = new Date();
    request.rejectionReason = dto.rejectionReason ?? request.rejectionReason;

    await request.save();

    const hostUserId = resolveId(request.requestedBy);

    await notifyWithdrawalStatusChanged(this.notificationService, {
      recipientUserId: hostUserId,
      withdrawalId: request._id.toString(),
      status: dto.status,
      amount: request.amount,
      walletType: request.walletType,
      rejectionReason: dto.rejectionReason,
    });

    if (shouldReleaseHold) {
      await this.walletService.releaseWithdrawalHold(
        hostUserId,
        request.walletType,
        request.amount,
      );
    }

    const populated = (await request.populate(
      WithdrawalsService.populateOptions,
    )) as WithdrawalDocument;

    const wallet = await this.walletService.getOrCreateWallet(hostUserId);

    return {
      ...this.toWithdrawalResponse(populated),
      hostPayoutDetails: wallet.payoutDetails,
    };
  }
}
