import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TurfBooking,
  TurfBookingDocument,
} from '../turf-booking/schemas/turf-booking.schema';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import { UpdatePayoutDetailsDto } from './dto/wallet.dto';
import type { IWalletResponse } from './interfaces/wallet.interface';
import { WalletUtility } from './utility/wallet.utility';

@Injectable()
export class WalletService {
  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(TurfBooking.name)
    private readonly turfBookingModel: Model<TurfBookingDocument>,
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
    const plain = wallet.toObject();
    return {
      ...plain,
      _id: wallet._id.toString(),
      heldBalance: wallet.heldBalance ?? 0,
      availableBalance: WalletService.getAvailableBalance(wallet),
      payoutDetails: WalletUtility.maskPayoutDetails(wallet.toObject().payoutDetails),
    };
  }

  static getAvailableBalance(wallet: {
    totalBalance: number;
    heldBalance?: number;
  }): number {
    return wallet.totalBalance - (wallet.heldBalance ?? 0);
  }

  async reserveWithdrawalHold(
    userId: string,
    amount: number,
  ): Promise<boolean> {
    const wallet = await this.walletModel.findOneAndUpdate(
      {
        user: new Types.ObjectId(userId),
        $expr: {
          $gte: [
            { $subtract: ['$totalBalance', { $ifNull: ['$heldBalance', 0] }] },
            amount,
          ],
        },
      },
      { $inc: { heldBalance: amount } },
      { new: true },
    );

    return !!wallet;
  }

  async releaseWithdrawalHold(
    userId: string,
    amount: number,
  ): Promise<void> {
    const wallet = await this.walletModel.findOne({
      user: new Types.ObjectId(userId),
    });
    if (!wallet) return;

    const releaseAmount = Math.min(amount, wallet.heldBalance ?? 0);
    if (releaseAmount <= 0) return;

    await this.walletModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId) },
      { $inc: { heldBalance: -releaseAmount } },
    );
  }

  async settleWithdrawal(userId: string, amount: number): Promise<boolean> {
    const wallet = await this.walletModel.findOneAndUpdate(
      {
        user: new Types.ObjectId(userId),
        totalBalance: { $gte: amount },
        heldBalance: { $gte: amount },
      },
      {
        $inc: {
          heldBalance: -amount,
          totalBalance: -amount,
          totalWithdrawn: amount,
        },
      },
      { new: true },
    );

    return !!wallet;
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
    return this.toWalletResponse(wallet);
  }

  /**
   * Atomically marks a booking as escrow-credited and moves `amount` to the host wallet escrow.
   * Returns false when this booking was already credited (idempotent no-op).
   */
  async moveAmountToEscrow(
    bookingId: string,
    userId: string,
    amount: number,
  ): Promise<boolean> {
    const lockResult = await this.turfBookingModel.updateOne(
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
          $inc: { escrowBalance: amount },
          $setOnInsert: { user: userObjectId },
        },
        { new: false },
      );
    }

    return true;
  }

  /**
   * Atomically marks a booking as escrow-released and moves `amount` from escrow to withdrawable balance.
   * Returns false when this booking was already released (idempotent no-op).
   */
  async releaseEscrowToTotal(
    bookingId: string,
    userId: string,
    amount: number,
  ): Promise<boolean> {
    const lockResult = await this.turfBookingModel.updateOne(
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
      const result = await this.walletModel.findOneAndUpdate(
        {
          user: new Types.ObjectId(userId),
          escrowBalance: { $gte: amount },
        },
        {
          $inc: {
            escrowBalance: -amount,
            totalBalance: amount,
            totalEarnings: amount,
          },
        },
        { new: true },
      );

      if (!result) {
        throw new NotFoundException(
          'Wallet not found or insufficient escrow balance',
        );
      }
    }

    return true;
  }

  async deductEscrow(userId: string, amount: number): Promise<void> {
    await this.walletModel.findOneAndUpdate(
      {
        user: new Types.ObjectId(userId),
        escrowBalance: { $gte: amount },
      },
      { $inc: { escrowBalance: -amount } },
    );
  }

  async deductWithdrawableBalance(userId: string, amount: number): Promise<boolean> {
    const wallet = await this.walletModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId), totalBalance: { $gte: amount } },
      {
        $inc: { totalBalance: -amount, totalWithdrawn: amount },
      },
      { new: true },
    );

    return !!wallet;
  }

  async hasSufficientWithdrawableBalance(
    userId: string,
    amount: number,
  ): Promise<boolean> {
    const wallet = await this.getOrCreateWallet(userId);
    return WalletService.getAvailableBalance(wallet) >= amount;
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
