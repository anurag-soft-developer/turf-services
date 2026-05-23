export enum RazorpayHostKycStatus {
  NOT_STARTED = 'not_started',
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  NEEDS_CLARIFICATION = 'needs_clarification',
  ACTIVATED = 'activated',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

export interface IHostOnboardingAddress {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface IHostOnboarding {
  razorpayAccountId?: string;
  razorpayProductId?: string;
  razorpayKycStatus: RazorpayHostKycStatus;
  statusMessage?: string;
  legalBusinessName?: string;
  appliedAt?: Date;
  activatedAt?: Date;
}

export interface HostOnboardingStatusResponse {
  razorpayKycStatus: RazorpayHostKycStatus;
  statusMessage?: string;
  canPublishTurfs: boolean;
  legalBusinessName?: string;
  appliedAt?: string;
  activatedAt?: string;
}

export function isHostPayoutReady(
  onboarding?: IHostOnboarding | null,
): boolean {
  return onboarding?.razorpayKycStatus === RazorpayHostKycStatus.ACTIVATED;
}
