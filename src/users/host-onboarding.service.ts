import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';
import { User, UserDocument } from './schemas/user.schema';
import { ApplyHostOnboardingDto } from './dto/host-onboarding.dto';
import {
  HostOnboardingStatusResponse,
  IHostOnboarding,
  isHostPayoutReady,
  RazorpayHostKycStatus,
} from './interfaces/host-onboarding.interface';
import type { IUser } from './interfaces/user.interface';

@Injectable()
export class HostOnboardingService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly rajorpayService: RajorpayService,
  ) {}

  getStatus(user: IUser | UserDocument): HostOnboardingStatusResponse {
    return this.toStatusResponse(user.hostOnboarding);
  }

  async apply(
    userId: string,
    user: IUser | UserDocument,
    dto: ApplyHostOnboardingDto,
  ): Promise<HostOnboardingStatusResponse> {
    const blockingStatuses: RazorpayHostKycStatus[] = [
      RazorpayHostKycStatus.PENDING,
      RazorpayHostKycStatus.UNDER_REVIEW,
      RazorpayHostKycStatus.NEEDS_CLARIFICATION,
      RazorpayHostKycStatus.ACTIVATED,
    ];

    if (
      blockingStatuses.includes(
        user.hostOnboarding?.razorpayKycStatus ??
          RazorpayHostKycStatus.NOT_STARTED,
      )
    ) {
      throw new ConflictException(
        'Host onboarding is already submitted or completed',
      );
    }

    const referenceId = userId.slice(-20);
    const account = await this.rajorpayService.createLinkedAccount({
      email: user.email,
      phone: dto.phone,
      legal_business_name: dto.legalBusinessName,
      business_type: dto.businessType,
      contact_name: dto.contactName,
      reference_id: referenceId,
      profile: {
        category: dto.category,
        subcategory: dto.subcategory,
        addresses: {
          registered: {
            street1: dto.registeredAddress.street1,
            street2: dto.registeredAddress.street2,
            city: dto.registeredAddress.city,
            state: dto.registeredAddress.state,
            postal_code: dto.registeredAddress.postalCode,
            country: dto.registeredAddress.country,
          },
        },
      },
      legal_info: {
        pan: dto.pan,
        ...(dto.gst ? { gst: dto.gst } : {}),
      },
    });

    await this.rajorpayService.createAccountStakeholder(account.id, {
      name: dto.contactName,
      email: user.email,
      addresses: {
        residential: {
          street1: dto.registeredAddress.street1,
          street2: dto.registeredAddress.street2,
          city: dto.registeredAddress.city,
          state: dto.registeredAddress.state,
          postal_code: dto.registeredAddress.postalCode,
          country: dto.registeredAddress.country,
        },
      },
    });

    const product = await this.rajorpayService.requestRouteProduct(account.id);

    const updatedProduct = await this.rajorpayService.updateRouteProduct(
      account.id,
      product.id,
      {
        settlements: {
          account_number: dto.bankAccountNumber,
          ifsc_code: dto.bankIfsc,
          beneficiary_name: dto.bankBeneficiaryName,
        },
        tnc_accepted: true,
      },
    );

    const kycStatus = this.mapProductActivationStatus(
      updatedProduct.activation_status,
    );

    const onboarding: IHostOnboarding = {
      razorpayAccountId: account.id,
      razorpayProductId: product.id,
      razorpayKycStatus: kycStatus,
      statusMessage: this.defaultStatusMessage(kycStatus),
      legalBusinessName: dto.legalBusinessName,
      appliedAt: new Date(),
      activatedAt:
        kycStatus === RazorpayHostKycStatus.ACTIVATED ? new Date() : undefined,
    };

    await this.userModel.findByIdAndUpdate(userId, {
      hostOnboarding: onboarding,
    });

    return this.toStatusResponse(onboarding);
  }

  async updateFromWebhook(params: {
    accountId?: string;
    productActivationStatus?: string;
    accountStatus?: string;
    statusMessage?: string;
  }): Promise<void> {
    if (!params.accountId) {
      return;
    }

    const user = await this.userModel
      .findOne({ 'hostOnboarding.razorpayAccountId': params.accountId })
      .exec();
    if (!user?.hostOnboarding?.razorpayAccountId) {
      return;
    }

    let kycStatus = user.hostOnboarding.razorpayKycStatus;

    if (params.productActivationStatus) {
      kycStatus = this.mapProductActivationStatus(
        params.productActivationStatus,
      );
    } else if (params.accountStatus) {
      kycStatus = this.mapAccountStatus(params.accountStatus);
    }

    const updates: Partial<IHostOnboarding> = {
      razorpayKycStatus: kycStatus,
      statusMessage:
        params.statusMessage ?? this.defaultStatusMessage(kycStatus),
    };

    if (kycStatus === RazorpayHostKycStatus.ACTIVATED) {
      updates.activatedAt = new Date();
    }

    user.hostOnboarding = {
      ...user.hostOnboarding,
      ...updates,
    };
    await user.save();
  }

  assertCanPublishTurfs(user: IUser | UserDocument): void {
    if (!isHostPayoutReady(user.hostOnboarding)) {
      throw new BadRequestException(
        'Complete host onboarding and Razorpay KYC activation before publishing turfs',
      );
    }
  }

  mapProductActivationStatus(status: string): RazorpayHostKycStatus {
    switch (status) {
      case 'activated':
        return RazorpayHostKycStatus.ACTIVATED;
      case 'under_review':
        return RazorpayHostKycStatus.UNDER_REVIEW;
      case 'needs_clarification':
        return RazorpayHostKycStatus.NEEDS_CLARIFICATION;
      case 'suspended':
        return RazorpayHostKycStatus.SUSPENDED;
      case 'requested':
      default:
        return RazorpayHostKycStatus.PENDING;
    }
  }

  mapAccountStatus(status: string): RazorpayHostKycStatus {
    switch (status) {
      case 'activated':
        return RazorpayHostKycStatus.ACTIVATED;
      case 'under_review':
        return RazorpayHostKycStatus.UNDER_REVIEW;
      case 'needs_clarification':
        return RazorpayHostKycStatus.NEEDS_CLARIFICATION;
      case 'rejected':
        return RazorpayHostKycStatus.REJECTED;
      case 'suspended':
        return RazorpayHostKycStatus.SUSPENDED;
      default:
        return RazorpayHostKycStatus.PENDING;
    }
  }

  private toStatusResponse(
    onboarding?: IHostOnboarding | null,
  ): HostOnboardingStatusResponse {
    return {
      ...onboarding,
      razorpayKycStatus: onboarding?.razorpayKycStatus ?? RazorpayHostKycStatus.NOT_STARTED,
      canPublishTurfs: isHostPayoutReady(onboarding),
      appliedAt: onboarding?.appliedAt?.toISOString(),
      activatedAt: onboarding?.activatedAt?.toISOString(),
    };
  }

  private defaultStatusMessage(status: RazorpayHostKycStatus): string {
    switch (status) {
      case RazorpayHostKycStatus.ACTIVATED:
        return 'Your payout account is active. You can publish turfs.';
      case RazorpayHostKycStatus.REJECTED:
        return 'Your KYC was rejected. Please review your details and apply again.';
      case RazorpayHostKycStatus.NEEDS_CLARIFICATION:
        return 'Additional information is required for activation.';
      case RazorpayHostKycStatus.SUSPENDED:
        return 'Your payout account is suspended. Contact support.';
      case RazorpayHostKycStatus.UNDER_REVIEW:
      case RazorpayHostKycStatus.PENDING:
        return 'Your account will be activated soon after Razorpay verifies your details.';
      default:
        return 'Complete onboarding to publish turfs and receive payouts.';
    }
  }
}
