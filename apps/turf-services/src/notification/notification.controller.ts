import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { config } from '../core/config/env.config';
import type { IUser } from '../users/interfaces/user.interface';
import {
  CreateNotificationDto,
  ListNotificationsQueryDto,
} from './dto/notification.dto';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async list(
    @CurrentUser() user: IUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationService.listForUser(String(user._id), query);
  }

  @Post('mark-all-read')
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: IUser) {
    return this.notificationService.markAllRead(String(user._id));
  }

  @Delete('all')
  @HttpCode(200)
  async deleteAll(@CurrentUser() user: IUser) {
    return this.notificationService.deleteAllForUser(String(user._id));
  }

  /**
   * Cross-service or worker: persist notification, WebSocket, then FCM if allowed.
   */
  // @Public()
  // @Post('internal/trigger')
  // async internalTrigger(
  //   @Headers('x-internal-token') internalToken: string | undefined,
  //   @Body() body: CreateNotificationDto,
  // ) {
  //   const expected = config.NOTIFICATION_INTERNAL_TOKEN;
  //   if (!expected || internalToken !== expected) {
  //     throw new UnauthorizedException('Invalid internal token');
  //   }
  //   return this.notificationService.createAndDispatch(body);
  // }

  @Get(':id')
  async getOne(@CurrentUser() user: IUser, @Param('id') id: string) {
    return this.notificationService.getOneForUser(String(user._id), id);
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: IUser, @Param('id') id: string) {
    return this.notificationService.markAsRead(String(user._id), id);
  }

  @Delete(':id')
  @HttpCode(200)
  async deleteOne(@CurrentUser() user: IUser, @Param('id') id: string) {
    return this.notificationService.deleteForUser(String(user._id), id);
  }
}
