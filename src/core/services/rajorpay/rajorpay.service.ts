import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/env.config';
import { IRajorpayOrder } from '../../interfaces/rajorpay.interface';

@Injectable()
export class RajorpayService {
  private static readonly DEFAULT_CURRENCY = 'INR';
  private static readonly API_BASE = 'https://api.razorpay.com';

  async createOrder(amount: number, receipt: string): Promise<IRajorpayOrder> {
    const amountInPaise = Math.round(amount * 100);
    return this.apiRequest<IRajorpayOrder>('/v1/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: amountInPaise,
        currency: RajorpayService.DEFAULT_CURRENCY,
        receipt,
      }),
    });
  }

  verifyPaymentSignature(params: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): boolean {
    const expectedSignature = createHmac('sha256', config.RAJORPAY_KEY_SECRET)
      .update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
      .digest('hex');

    return this.safeEqualSignatures(
      expectedSignature,
      params.razorpaySignature,
    );
  }

  verifyWebhookSignature(
    rawPayload: string | Buffer,
    signature: string,
  ): boolean {
    if (!config.RAJORPAY_WEBHOOK_SECRET) {
      throw new BadRequestException('Webhook secret is not configured');
    }
    const expectedSignature = createHmac(
      'sha256',
      config.RAJORPAY_WEBHOOK_SECRET,
    )
      .update(rawPayload)
      .digest('hex');
    return this.safeEqualSignatures(expectedSignature, signature);
  }

  calculateOwnerPayoutAmount(totalAmount: number): {
    platformFeeAmount: number;
    ownerPayoutAmount: number;
  } {
    const platformFeePercent = config.PLATFORM_FEE_PERCENT;
    const platformFeeAmount =
      Math.round(((totalAmount * platformFeePercent) / 100) * 100) / 100;
    const ownerPayoutAmount =
      Math.round((totalAmount - platformFeeAmount) * 100) / 100;
    return { platformFeeAmount, ownerPayoutAmount };
  }

  private async apiRequest<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${RajorpayService.API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: this.getBasicAuthHeader(),
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      const description =
        typeof body.error === 'object' &&
        body.error !== null &&
        'description' in body.error
          ? String((body.error as { description?: string }).description)
          : typeof body.error === 'string'
            ? body.error
            : 'Razorpay API request failed';
      throw new BadRequestException(description);
    }

    return body as T;
  }

  private getBasicAuthHeader(): string {
    const credentials = `${config.RAJORPAY_KEY_ID}:${config.RAJORPAY_KEY_SECRET}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  private safeEqualSignatures(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
