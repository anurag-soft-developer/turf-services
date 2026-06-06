import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EventBooking,
  EventBookingDocument,
} from '../event-booking/schemas/event-booking.schema';
import {
  TurfBooking,
  TurfBookingDocument,
} from '../turf-booking/schemas/turf-booking.schema';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import { UpdatePayoutDetailsDto } from './dto/wallet.dto';
import type { IWalletResponse } from './interfaces/wallet.interface';
import { WalletType } from './interfaces/wallet.interface';
import { WalletUtility } from './utility/wallet.utility';

@Injectable()
export class WalletService {
  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(TurfBooking.name)
    private readonly turfBookingModel: Model<TurfBookingDocument>,
    @InjectModel(EventBooking.name)
    private readonly eventBookingModel: Model<EventBookingDocument>,
  ) {}

  async getOrCreateWallet(userId: string): Promise<WalletDocument> {
    const userObjectId = new Types.ObjectId(userId);
    const wallet = await this.findOneAndUpsertWithRetry(
      { user: userObjectId },
      { $setOnInsert: { user: userObjectId } },
      { new: true },
    );

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }

  async getWalletByUserId(userId: string): Promise<IWalletResponse> {
    const wallet = await this.getOrCreateWallet(userId);
    return this.toWalletResponse(wallet);
  }

  toWalletResponse(wallet: WalletDocument): IWalletResponse {
    return {
      _id: wallet._id.toString(),
      user: wallet.user,
      turfWallet: WalletUtility.toLaneResponse(wallet.turfWallet),
      eventWallet: WalletUtility.toLaneResponse(wallet.eventWallet),
      payoutDetails: wallet.payoutDetails,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      turfAvailableBalance: WalletUtility.getTurfAvailableBalance(wallet),
      eventAvailableBalance: WalletUtility.getEventAvailableBalance(wallet),
      availableBalance: WalletService.getAvailableBalance(wallet),
    };
  }

  static getAvailableBalance(
    wallet: Parameters<typeof WalletUtility.getCombinedAvailableBalance>[0],
  ): number {
    return WalletUtility.getCombinedAvailableBalance(wallet);
  }

  async reserveWithdrawalHold(
    userId: string,
    amount: number,
  ): Promise<boolean> {
    const wallet = await this.getOrCreateWallet(userId);
    const split = WalletUtility.splitWithdrawalHold(wallet, amount);
    if (!split) {
      return false;
    }

    const { turfHold, eventHold } = split;
    const inc: Record<string, number> = {};
    if (turfHold > 0) {
      Object.assign(
        inc,
        WalletUtility.buildIncPatch(WalletType.TURF, 'heldBalance', turfHold),
      );
    }
    if (eventHold > 0) {
      Object.assign(
        inc,
        WalletUtility.buildIncPatch(WalletType.EVENT, 'heldBalance', eventHold),
      );
    }
    if (Object.keys(inc).length === 0) {
      return false;
    }

    const updated = await this.walletModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId) },
      { $inc: inc },
      { new: true },
    );

    return !!updated;
  }

  async releaseWithdrawalHold(
    userId: string,
    amount: number,
  ): Promise<void> {
    const wallet = await this.walletModel.findOne({
      user: new Types.ObjectId(userId),
    });
    if (!wallet) return;

    const { turfRelease, eventRelease } =
      WalletUtility.splitWithdrawalRelease(wallet, amount);

    const inc: Record<string, number> = {};
    if (turfRelease > 0) {
      Object.assign(
        inc,
        WalletUtility.buildIncPatch(
          WalletType.TURF,
          'heldBalance',
          -turfRelease,
        ),
      );
    }
    const eventHeld = WalletUtility.getLane(wallet, WalletType.EVENT).heldBalance;
    const actualEventRelease = Math.min(eventRelease, eventHeld);
    if (actualEventRelease > 0) {
      Object.assign(
        inc,
        WalletUtility.buildIncPatch(
          WalletType.EVENT,
          'heldBalance',
          -actualEventRelease,
        ),
      );
    }
    if (Object.keys(inc).length === 0) return;

    await this.walletModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId) },
      { $inc: inc },
    );
  }

  async settleWithdrawal(userId: string, amount: number): Promise<boolean> {
    const wallet = await this.getOrCreateWallet(userId);
    const { turfRelease, eventRelease } =
      WalletUtility.splitWithdrawalRelease(wallet, amount);

    const turfHeld = WalletUtility.getLane(wallet, WalletType.TURF).heldBalance;
    const eventHeld = WalletUtility.getLane(wallet, WalletType.EVENT).heldBalance;
    const eventSettle = Math.min(eventRelease, eventHeld);

    if (turfHeld < turfRelease || eventHeld < eventSettle) {
      return false;
    }

    const turfAvailable = WalletUtility.getTurfAvailableBalance(wallet);
    const eventAvailable = WalletUtility.getEventAvailableBalance(wallet);
    if (turfAvailable < turfRelease || eventAvailable < eventSettle) {
      return false;
    }

    const inc: Record<string, number> = {};
    if (turfRelease > 0) {
      Object.assign(
        inc,
        WalletUtility.buildIncPatch(WalletType.TURF, 'heldBalance', -turfRelease),
        WalletUtility.buildIncPatch(
          WalletType.TURF,
          'totalBalance',
          -turfRelease,
        ),
        WalletUtility.buildIncPatch(
          WalletType.TURF,
          'totalWithdrawn',
          turfRelease,
        ),
      );
    }
    if (eventSettle > 0) {
      Object.assign(
        inc,
        WalletUtility.buildIncPatch(
          WalletType.EVENT,
          'heldBalance',
          -eventSettle,
        ),
        WalletUtility.buildIncPatch(
          WalletType.EVENT,
          'totalBalance',
          -eventSettle,
        ),
        WalletUtility.buildIncPatch(
          WalletType.EVENT,
          'totalWithdrawn',
          eventSettle,
        ),
      );
    }

    const filter: Record<string, unknown> = {
      user: new Types.ObjectId(userId),
    };
    if (turfRelease > 0) {
      filter[WalletUtility.lanePath(WalletType.TURF, 'heldBalance')] = {
        $gte: turfRelease,
      };
      filter[WalletUtility.lanePath(WalletType.TURF, 'totalBalance')] = {
        $gte: turfRelease,
      };
    }
    if (eventSettle > 0) {
      filter[WalletUtility.lanePath(WalletType.EVENT, 'heldBalance')] = {
        $gte: eventSettle,
      };
      filter[WalletUtility.lanePath(WalletType.EVENT, 'totalBalance')] = {
        $gte: eventSettle,
      };
    }

    const updated = await this.walletModel.findOneAndUpdate(
      filter,
      { $inc: inc },
      { new: true },
    );

    return !!updated;
  }

  async updatePayoutDetails(
    userId: string,
    dto: UpdatePayoutDetailsDto,
  ): Promise<IWalletResponse> {
    const userObjectId = new Types.ObjectId(userId);
    const payoutPatch = WalletUtility.buildPayoutDetailsPatch(dto);

    const wallet = await this.findOneAndUpsertWithRetry(
      { user: userObjectId },
      {
        $set: payoutPatch,
        $setOnInsert: { user: userObjectId },
      },
      { new: true },
    );

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (
      dto.primaryMethod !== undefined &&
      !WalletUtility.hasCompleteMethodDetails(
        wallet.payoutDetails,
        dto.primaryMethod,
      )
    ) {
      throw new BadRequestException(
        `Complete ${dto.primaryMethod} payout details required before setting as primary method`,
      );
    }

    return this.toWalletResponse(wallet);
  }

  async moveAmountToEscrow(
    walletType: WalletType,
    bookingId: string,
    userId: string,
    amount: number,
  ): Promise<boolean> {
    return this.creditEscrow(walletType, bookingId, userId, amount);
  }

  async releaseEscrowToTotal(
    walletType: WalletType,
    bookingId: string,
    userId: string,
    amount: number,
  ): Promise<boolean> {
    return this.releaseEscrow(walletType, bookingId, userId, amount);
  }

  async deductEscrow(
    walletType: WalletType,
    userId: string,
    amount: number,
  ): Promise<void> {
    await this.walletModel.findOneAndUpdate(
      {
        user: new Types.ObjectId(userId),
        [WalletUtility.lanePath(walletType, 'escrowBalance')]: { $gte: amount },
      },
      {
        $inc: WalletUtility.buildIncPatch(
          walletType,
          'escrowBalance',
          -amount,
        ),
      },
    );
  }

  async deductWithdrawableBalance(userId: string, amount: number): Promise<boolean> {
    const wallet = await this.getOrCreateWallet(userId);
    const split = WalletUtility.splitWithdrawalHold(wallet, amount);
    if (!split) {
      return false;
    }

    const { turfHold, eventHold } = split;
    const inc: Record<string, number> = {};
    if (turfHold > 0) {
      Object.assign(
        inc,
        WalletUtility.buildIncPatch(WalletType.TURF, 'totalBalance', -turfHold),
        WalletUtility.buildIncPatch(
          WalletType.TURF,
          'totalWithdrawn',
          turfHold,
        ),
      );
    }
    if (eventHold > 0) {
      Object.assign(
        inc,
        WalletUtility.buildIncPatch(
          WalletType.EVENT,
          'totalBalance',
          -eventHold,
        ),
        WalletUtility.buildIncPatch(
          WalletType.EVENT,
          'totalWithdrawn',
          eventHold,
        ),
      );
    }

    const updated = await this.walletModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId) },
      { $inc: inc },
      { new: true },
    );

    return !!updated;
  }

  async hasSufficientWithdrawableBalance(
    userId: string,
    amount: number,
  ): Promise<boolean> {
    const wallet = await this.getOrCreateWallet(userId);
    return WalletService.getAvailableBalance(wallet) >= amount;
  }

  private async creditEscrow(
    walletType: WalletType,
    bookingId: string,
    userId: string,
    amount: number,
  ): Promise<boolean> {
    const bookingModel = this.getBookingModel(walletType);
    const lockResult = await bookingModel.updateOne(
      {
        _id: new Types.ObjectId(bookingId),
        escrowCreditedAt: { $exists: false },
      },
      {
        $set: { escrowCreditedAt: new Date() },
      },
    );
    if (lockResult.modifiedCount === 0) {
      return false;
    }

    if (amount > 0) {
      const userObjectId = new Types.ObjectId(userId);
      await this.findOneAndUpsertWithRetry(
        { user: userObjectId },
        {
          $inc: WalletUtility.buildIncPatch(
            walletType,
            'escrowBalance',
            amount,
          ),
          $setOnInsert: { user: userObjectId },
        },
        { new: false },
      );
    }

    return true;
  }

  private async releaseEscrow(
    walletType: WalletType,
    bookingId: string,
    userId: string,
    amount: number,
  ): Promise<boolean> {
    const bookingModel = this.getBookingModel(walletType);
    const lockResult = await bookingModel.updateOne(
      {
        _id: new Types.ObjectId(bookingId),
        escrowReleasedAt: { $exists: false },
      },
      {
        $set: { escrowReleasedAt: new Date() },
      },
    );
    if (lockResult.modifiedCount === 0) {
      return false;
    }

    if (amount > 0) {
      const escrowPath = WalletUtility.lanePath(walletType, 'escrowBalance');
      const result = await this.walletModel.findOneAndUpdate(
        {
          user: new Types.ObjectId(userId),
          [escrowPath]: { $gte: amount },
        },
        {
          $inc: {
            ...WalletUtility.buildIncPatch(walletType, 'escrowBalance', -amount),
            ...WalletUtility.buildIncPatch(walletType, 'totalBalance', amount),
            ...WalletUtility.buildIncPatch(walletType, 'totalEarnings', amount),
          },
        },
        { new: true },
      );

      if (!result) {
        throw new NotFoundException(
          `Wallet not found or insufficient ${walletType} escrow balance`,
        );
      }
    }

    return true;
  }

  private getBookingModel(
    walletType: WalletType,
  ): Model<TurfBookingDocument | EventBookingDocument> {
    return walletType === WalletType.TURF
      ? this.turfBookingModel
      : this.eventBookingModel;
  }

  private async findOneAndUpsertWithRetry(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { new: boolean },
  ) {
    try {
      return await this.walletModel.findOneAndUpdate(filter, update, {
        ...options,
        upsert: true,
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        return await this.walletModel.findOneAndUpdate(filter, update, options);
      }
      throw error;
    }
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
