import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { notificationDispatchSchema } from '../../../../libs';
import { config } from '../core/config/env.config';
import { NotificationGateway } from './notification.gateway';

@Controller('internal/notifications')
export class NotificationController {
  constructor(private readonly notificationGateway: NotificationGateway) {}

  @Post('dispatch')
  dispatch(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = config.INTERNAL_TOKEN;
    if (!expected || internalToken !== expected) {
      throw new UnauthorizedException('Invalid internal token');
    }
    const parsed = notificationDispatchSchema.parse(body);
    this.notificationGateway.pushToUser(parsed.userId, parsed);
    return { ok: true };
  }
}
