import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/env.config';
import { IRajorpayOrder } from '../../interfaces/rajorpay.interface';
import type {
  IRazorpayLinkedAccount,
  IRazorpayProduct,
  IRazorpayTransferResponse,
} from '../../interfaces/rajorpay-route.interface';

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

  async createLinkedAccount(payload: Record<string, unknown>): Promise<IRazorpayLinkedAccount> {
    return this.apiRequest<IRazorpayLinkedAccount>('/v2/accounts', {
      method: 'POST',
      body: JSON.stringify({ ...payload, type: 'route' }),
    });
  }

  async createAccountStakeholder(
    accountId: string,
    payload: Record<string, unknown>,
  ): Promise<{ id: string }> {
    return this.apiRequest<{ id: string }>(
      `/v2/accounts/${accountId}/stakeholders`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  }

  async requestRouteProduct(
    accountId: string,
  ): Promise<IRazorpayProduct> {
    return this.apiRequest<IRazorpayProduct>(
      `/v2/accounts/${accountId}/products`,
      {
        method: 'POST',
        body: JSON.stringify({
          product_name: 'route',
          tnc_accepted: true,
        }),
      },
    );
  }

  async updateRouteProduct(
    accountId: string,
    productId: string,
    payload: Record<string, unknown>,
  ): Promise<IRazorpayProduct> {
    return this.apiRequest<IRazorpayProduct>(
      `/v2/accounts/${accountId}/products/${productId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
    );
  }

  async createTransfersFromPayment(
    paymentId: string,
    transfers: Array<{ account: string; amount: number; currency?: string }>,
  ): Promise<IRazorpayTransferResponse> {
    return this.apiRequest<IRazorpayTransferResponse>(
      `/v1/payments/${paymentId}/transfers`,
      {
        method: 'POST',
        body: JSON.stringify({
          transfers: transfers.map((t) => ({
            account: t.account,
            amount: t.amount,
            currency: t.currency ?? RajorpayService.DEFAULT_CURRENCY,
            on_hold: false,
          })),
        }),
      },
    );
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
