import type { PayoutSnapshot } from '../../withdrawals/interfaces/withdrawal.interface';
import type { PayoutDetails } from '../interfaces/wallet.interface';
import { PayoutMethod } from '../interfaces/wallet.interface';
import type { UpdatePayoutDetailsDto } from '../dto/wallet.dto';

export class WalletUtility {
  static maskAccountNumber(value?: string): string | undefined {
    if (!value) return undefined;
    if (value.length <= 4) return value;
    return `****${value.slice(-4)}`;
  }

  static maskUpiId(value?: string): string | undefined {
    if (!value) return undefined;
    const atIndex = value.indexOf('@');
    if (atIndex <= 0) return value;
    const local = value.slice(0, atIndex);
    const domain = value.slice(atIndex);
    if (local.length <= 4) return value;
    return `${local.slice(0, 4)}****${domain}`;
  }

  static maskPayoutDetails(
    payoutDetails?: PayoutDetails,
  ): PayoutDetails | undefined {
    if (!payoutDetails) return undefined;
    return {
      ...payoutDetails,
      accountNumber: WalletUtility.maskAccountNumber(
        payoutDetails.accountNumber,
      ),
      upiId: WalletUtility.maskUpiId(payoutDetails.upiId),
    };
  }

  static maskPayoutSnapshot(
    snapshot?: PayoutSnapshot,
  ): PayoutSnapshot | undefined {
    if (!snapshot) return undefined;
    return {
      ...snapshot,
      accountNumber: WalletUtility.maskAccountNumber(snapshot.accountNumber),
      upiId: WalletUtility.maskUpiId(snapshot.upiId),
    };
  }

  static hasCompleteUpiDetails(payoutDetails?: PayoutDetails): boolean {
    if (!payoutDetails) return false;
    return (
      typeof payoutDetails.upiId === 'string' &&
      /^[a-z0-9.\-_]{2,256}@[a-z]{2,64}$/.test(payoutDetails.upiId)
    );
  }

  static hasCompleteBankDetails(payoutDetails?: PayoutDetails): boolean {
    if (!payoutDetails) return false;

    const accountNumber = payoutDetails.accountNumber?.trim();
    const ifscCode = payoutDetails.ifscCode?.trim();

    return (
      Boolean(payoutDetails.accountHolderName?.trim()) &&
      Boolean(payoutDetails.bankName?.trim()) &&
      Boolean(accountNumber) &&
      Boolean(ifscCode) &&
      /^[0-9]+$/.test(accountNumber!) &&
      /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode!.toUpperCase())
    );
  }

  static hasCompleteMethodDetails(
    payoutDetails: PayoutDetails | undefined,
    method: PayoutMethod,
  ): boolean {
    if (!payoutDetails) return false;
    return method === PayoutMethod.UPI
      ? WalletUtility.hasCompleteUpiDetails(payoutDetails)
      : WalletUtility.hasCompleteBankDetails(payoutDetails);
  }

  static resolvePrimaryMethod(
    payoutDetails?: PayoutDetails,
  ): PayoutMethod | undefined {
    if (!payoutDetails) return undefined;

    if (payoutDetails.primaryMethod) {
      return payoutDetails.primaryMethod;
    }

    const hasUpi = WalletUtility.hasCompleteUpiDetails(payoutDetails);
    const hasBank = WalletUtility.hasCompleteBankDetails(payoutDetails);

    if (hasUpi && !hasBank) return PayoutMethod.UPI;
    if (hasBank && !hasUpi) return PayoutMethod.BANK;

    return undefined;
  }

  static hasCompletePayoutDetails(payoutDetails?: PayoutDetails): boolean {
    const method = WalletUtility.resolvePrimaryMethod(payoutDetails);
    if (!method) return false;
    return WalletUtility.hasCompleteMethodDetails(payoutDetails, method);
  }


  static buildPayoutSnapshotForMethod(
    payoutDetails: PayoutDetails | undefined,
    method: PayoutMethod,
  ): PayoutSnapshot | undefined {
    if (!WalletUtility.hasCompleteMethodDetails(payoutDetails, method)) {
      return undefined;
    }

    if (method === PayoutMethod.UPI) {
      return {
        method,
        upiId: payoutDetails!.upiId,
      };
    }

    return {
      method,
      accountHolderName: payoutDetails!.accountHolderName,
      bankName: payoutDetails!.bankName,
      accountNumber: payoutDetails!.accountNumber,
      ifscCode: payoutDetails!.ifscCode,
    };
  }

  /** Mongo $set keys for only the payout fields present in the PATCH payload. */
  static buildPayoutDetailsPatch(
    dto: UpdatePayoutDetailsDto,
  ): Record<string, string> {
    const set: Record<string, string> = {};

    if (dto.primaryMethod !== undefined) {
      set['payoutDetails.primaryMethod'] = dto.primaryMethod;
    }
    if (dto.accountHolderName !== undefined) {
      set['payoutDetails.accountHolderName'] = dto.accountHolderName;
    }
    if (dto.bankName !== undefined) {
      set['payoutDetails.bankName'] = dto.bankName;
    }
    if (dto.accountNumber !== undefined) {
      set['payoutDetails.accountNumber'] = dto.accountNumber;
    }
    if (dto.ifscCode !== undefined) {
      set['payoutDetails.ifscCode'] = dto.ifscCode.toUpperCase();
    }
    if (dto.upiId !== undefined) {
      set['payoutDetails.upiId'] = dto.upiId.toLowerCase();
    }

    return set;
  }
}
