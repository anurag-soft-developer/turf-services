import { Injectable } from '@nestjs/common';
import { HostOnboardingService } from '../users/host-onboarding.service';
import { RazorpayWebhookPayloadDto } from './dto/razorpay-webhook.dto';

@Injectable()
export class HostOnboardingWebhookService {
  constructor(
    private readonly hostOnboardingService: HostOnboardingService,
  ) {}

  async processWebhookEvent(eventPayload: RazorpayWebhookPayloadDto): Promise<{
    processed: boolean;
    message: string;
  }> {
    const eventType = eventPayload.event;
    const hostEvents = new Set([
      'product.route.activated',
      'product.route.under_review',
      'product.route.needs_clarification',
      'account.activated',
      'account.under_review',
      'account.needs_clarification',
      'account.rejected',
      'account.suspended',
    ]);

    if (!hostEvents.has(eventType)) {
      return { processed: false, message: `Event ${eventType} ignored for host` };
    }

    const productEntity = this.extractEntity(eventPayload, 'product');
    const accountEntity = this.extractEntity(eventPayload, 'account');

    const accountId =
      (typeof productEntity?.account_id === 'string'
        ? productEntity.account_id
        : undefined) ??
      (typeof accountEntity?.id === 'string' ? accountEntity.id : undefined);

    const productActivationStatus =
      typeof productEntity?.activation_status === 'string'
        ? productEntity.activation_status
        : undefined;

    const accountStatus =
      typeof accountEntity?.status === 'string'
        ? accountEntity.status
        : undefined;

    await this.hostOnboardingService.updateFromWebhook({
      accountId,
      productActivationStatus,
      accountStatus,
      statusMessage: this.messageForEvent(eventType),
    });

    return { processed: true, message: `${eventType} processed for host onboarding` };
  }

  private extractEntity(
    payload: RazorpayWebhookPayloadDto,
    key: string,
  ): Record<string, unknown> | undefined {
    const wrapper = payload.payload?.[key] as
      | { entity?: Record<string, unknown> }
      | undefined;
    return wrapper?.entity;
  }

  private messageForEvent(eventType: string): string | undefined {
    if (eventType === 'product.route.activated' || eventType === 'account.activated') {
      return 'Your payout account is active. You can publish turfs.';
    }
    if (eventType === 'account.rejected') {
      return 'Your KYC was rejected. Please review your details and apply again.';
    }
    if (
      eventType === 'product.route.under_review' ||
      eventType === 'account.under_review'
    ) {
      return 'Your account will be activated soon after Razorpay verifies your details.';
    }
    if (
      eventType === 'product.route.needs_clarification' ||
      eventType === 'account.needs_clarification'
    ) {
      return 'Additional information is required for activation.';
    }
    if (eventType === 'account.suspended') {
      return 'Your payout account is suspended. Contact support.';
    }
    return undefined;
  }
}
