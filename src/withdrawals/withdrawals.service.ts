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
import { WalletService } from '../wallet/wallet.service';
import { WalletUtility } from '../wallet/utility/wallet.utility';
import { UserRole } from '../auth/decorators/roles.decorator';

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
  ) {}

  async createRequest(
    userId: string,
    dto: CreateWithdrawalRequestDto,
  ): Promise<WithdrawalDocument> {
    const wallet = await this.walletService.getOrCreateWallet(userId);

    if (!WalletUtility.hasCompletePayoutDetails(wallet.payoutDetails)) {
      throw new BadRequestException(
        'Complete payout details required before requesting withdrawal',
      );
    }

    const reserved = await this.walletService.reserveWithdrawalHold(
      userId,
      dto.amount,
    );
    if (!reserved) {
      throw new BadRequestException('Insufficient balance for withdrawal');
    }

    try {
      const created = await this.withdrawalModel.create({
        requestedBy: userId,
        amount: dto.amount,
        status: WithdrawalStatus.PENDING,
        comments: [],
        attachments: [],
      });

      return (await created.populate(
        WithdrawalsService.populateOptions,
      )) as WithdrawalDocument;
    } catch (error) {
      await this.walletService.releaseWithdrawalHold(userId, dto.amount);
      throw error;
    }
  }

  async getById(
    withdrawalId: string,
    userId: string,
    userRole: string,
  ): Promise<WithdrawalDocument> {
    const request = await this.withdrawalModel
      .findById(withdrawalId)
      .populate(WithdrawalsService.populateOptions);

    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    const isOwner = request.requestedBy.toString() === userId;
    const isPlatformAdmin = userRole === UserRole.PLATFORM_ADMIN;

    if (!isOwner && !isPlatformAdmin) {
      throw new ForbiddenException('Access denied');
    }

    return request as WithdrawalDocument;
  }

  async cancelRequest(
    withdrawalId: string,
    userId: string,
  ): Promise<WithdrawalDocument> {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    if (request.requestedBy.toString() !== userId) {
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

    await this.walletService.releaseWithdrawalHold(userId, request.amount);

    return (await request.populate(
      WithdrawalsService.populateOptions,
    )) as WithdrawalDocument;
  }

  async listMine(
    userId: string,
    filter: WithdrawalFilterDto,
  ): Promise<PaginatedResult<WithdrawalDocument>> {
    const { status, page = 1, limit = 20 } = filter;
    const query: Record<string, unknown> = { requestedBy: userId };
    if (status) query.status = status;

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
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async listAll(
    filter: WithdrawalFilterDto,
  ): Promise<PaginatedResult<WithdrawalDocument>> {
    const { status, userId, page = 1, limit = 20 } = filter;
    const query: Record<string, unknown> = {};
    if (status) query.status = status;
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
      data,
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
  ): Promise<WithdrawalDocument> {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    if (WithdrawalUtility.isTerminalStatus(request.status)) {
      throw new BadRequestException(
        'Cannot add comment to a terminal withdrawal request',
      );
    }

    request.comments.push({
      addedBy: new Types.ObjectId(userId),
      message: dto.message,
      createdAt: new Date(),
    });
    await request.save();

    return (await request.populate(
      WithdrawalsService.populateOptions,
    )) as WithdrawalDocument;
  }

  async addAttachments(
    withdrawalId: string,
    dto: AddWithdrawalAttachmentsDto,
  ): Promise<WithdrawalDocument> {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    if (WithdrawalUtility.isTerminalStatus(request.status)) {
      throw new BadRequestException(
        'Cannot update attachments on a terminal withdrawal request',
      );
    }

    const mergedAttachments = [...request.attachments, ...dto.attachments];
    if (mergedAttachments.length > 10) {
      throw new BadRequestException('A maximum of 10 attachments are allowed');
    }

    request.attachments = mergedAttachments;
    await request.save();

    return (await request.populate(
      WithdrawalsService.populateOptions,
    )) as WithdrawalDocument;
  }

  async updateStatus(
    withdrawalId: string,
    adminUserId: string,
    dto: UpdateWithdrawalStatusDto,
  ): Promise<WithdrawalDocument> {
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
      const settled = await this.walletService.settleWithdrawal(
        request.requestedBy.toString(),
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

    if (shouldReleaseHold) {
      await this.walletService.releaseWithdrawalHold(
        request.requestedBy.toString(),
        request.amount,
      );
    }

    return (await request.populate(
      WithdrawalsService.populateOptions,
    )) as WithdrawalDocument;
  }
}
