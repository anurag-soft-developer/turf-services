import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { IUser } from '../users/interfaces/user.interface';
import { Public } from '../auth/decorators/public.decorator';
import {
  ChatReadBodyDto,
  ChatHideBodyDto,
  InternalChatAccessQueryDto,
  InternalMarkChatReadDto,
  ListChatInboxQueryDto,
  ListChatReadCursorsQueryDto,
} from './dto/chat.dto';
import { ChatService } from './chat.service';
import { config } from '../core/config/env.config';

@Controller('chat')
export class ChatInboxController {
  constructor(private readonly chatService: ChatService) {}

  @Get('inbox')
  async listInbox(
    @CurrentUser() user: IUser,
    @Query() query: ListChatInboxQueryDto,
  ) {
    return this.chatService.listInbox(String(user._id), query);
  }

  @Post('read')
  @HttpCode(200)
  async markRead(@CurrentUser() user: IUser, @Body() dto: ChatReadBodyDto) {
    return this.chatService.markRead(String(user._id), dto);
  }

  @Post('hide')
  @HttpCode(200)
  async hideThreads(@CurrentUser() user: IUser, @Body() dto: ChatHideBodyDto) {
    return this.chatService.hideThreads(String(user._id), dto.items);
  }

  @Get('read-cursors')
  async listReadCursors(
    @CurrentUser() user: IUser,
    @Query() query: ListChatReadCursorsQueryDto,
  ) {
    return this.chatService.listReadCursors(String(user._id), query);
  }

  @Public()
  @Get('access/internal')
  async assertAccessInternal(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Query() query: InternalChatAccessQueryDto,
  ) {
    this.assertInternalToken(internalToken);
    return this.chatService.assertAccess(query.userId, query);
  }

  @Public()
  @Post('read/internal')
  @HttpCode(200)
  async markReadInternal(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Body() dto: InternalMarkChatReadDto,
  ) {
    this.assertInternalToken(internalToken);
    return this.chatService.markRead(dto.userId, dto);
  }

  private assertInternalToken(internalToken: string | undefined): void {
    const expectedToken = config.INTERNAL_TOKEN;
    if (!expectedToken || internalToken !== expectedToken) {
      throw new UnauthorizedException('Invalid internal token');
    }
  }
}
