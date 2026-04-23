import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
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
    @Body() payload: RazorpayWebhookPayloadDto,
    @Headers('x-razorpay-signature') webhookSignature?: string,
  ) {
    return this.razorpayWebhookService.handleRazorpayWebhook(
      payload,
      webhookSignature,
    );
  }
}
