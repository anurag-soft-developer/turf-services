import type { PayoutDetails } from '../interfaces/wallet.interface';
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

  static hasCompletePayoutDetails(payoutDetails?: PayoutDetails): boolean {
    if (!payoutDetails) return false;

    const hasUpi =
      typeof payoutDetails.upiId === 'string' &&
      /^[a-z0-9.\-_]{2,256}@[a-z]{2,64}$/.test(payoutDetails.upiId);

    const accountNumber = payoutDetails.accountNumber?.trim();
    const ifscCode = payoutDetails.ifscCode?.trim();

    const hasBank =
      Boolean(payoutDetails.accountHolderName?.trim()) &&
      Boolean(payoutDetails.bankName?.trim()) &&
      Boolean(accountNumber) &&
      Boolean(ifscCode) &&
      /^[0-9]+$/.test(accountNumber!) &&
      /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode!.toUpperCase());

    return hasUpi || hasBank;
  }

  /** Mongo $set keys for only the payout fields present in the PATCH payload. */
  static buildPayoutDetailsPatch(
    dto: UpdatePayoutDetailsDto,
  ): Record<string, string> {
    const set: Record<string, string> = {};

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
