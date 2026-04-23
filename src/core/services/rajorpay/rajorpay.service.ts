import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/env.config';
import { IRajorpayOrder } from '../../interfaces/rajorpay.interface';

@Injectable()
export class RajorpayService {
  private static readonly DEFAULT_CURRENCY = 'INR';

  async createOrder(amount: number, receipt: string): Promise<IRajorpayOrder> {
    const amountInPaise = Math.round(amount * 100);
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: this.getBasicAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: RajorpayService.DEFAULT_CURRENCY,
        receipt,
      }),
    });

    if (!response.ok) {
      throw new BadRequestException('Failed to create Razorpay order');
    }

    return (await response.json()) as IRajorpayOrder;
  }

  verifyPaymentSignature(params: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): boolean {
    const expectedSignature = createHmac('sha256', config.RAJORPAY_KEY_SECRET)
      .update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
      .digest('hex');

    return this.safeEqualSignatures(expectedSignature, params.razorpaySignature);
  }

  verifyWebhookSignature(rawPayload: unknown, signature: string): boolean {
    if (!config.RAJORPAY_WEBHOOK_SECRET) {
      throw new BadRequestException('Webhook secret is not configured');
    }

    const expectedSignature = createHmac('sha256', config.RAJORPAY_WEBHOOK_SECRET)
      .update(JSON.stringify(rawPayload))
      .digest('hex');
    return this.safeEqualSignatures(expectedSignature, signature);
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
