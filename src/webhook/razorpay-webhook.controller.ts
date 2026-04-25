import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { RazorpayWebhookPayloadDto } from './dto/razorpay-webhook.dto';
import { RazorpayWebhookService } from './razorpay-webhook.service';

@Controller('webhooks')
export class RazorpayWebhookController {
  constructor(private readonly razorpayWebhookService: RazorpayWebhookService) {}

  @Post('razorpay')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: RazorpayWebhookPayloadDto,
    @Headers('x-razorpay-signature') webhookSignature?: string,
  ) {
    const rawWebhookPayload = req.rawBody?.toString('utf-8');
    return this.razorpayWebhookService.handleRazorpayWebhook(
      payload,
      rawWebhookPayload || '',
      webhookSignature,
    );
  }
}
