import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { IUser } from '../users/interfaces/user.interface';
import { Public } from '../auth/decorators/public.decorator';
import {
  BatchPersistMessagesDto,
  InternalListChatMessagesQueryDto,
  ListChatMessagesQueryDto,
} from './dto/chat.dto';
import { ChatService } from './chat.service';
import { config } from '../core/config/env.config';

@Controller('chat/messages')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Public()
  @Post('batch')
  async batchPersist(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Body() dto: BatchPersistMessagesDto,
  ) {
    const expectedToken = config.CHAT_BATCH_INTERNAL_TOKEN;
    if (!expectedToken || internalToken !== expectedToken) {
      throw new UnauthorizedException('Invalid internal token');
    }

    return this.chatService.batchPersistMessages(dto.messages);
  }

  @Get()
  async listMessages(
    @CurrentUser() user: IUser,
    @Query() query: ListChatMessagesQueryDto,
  ) {
    return this.chatService.listMessages(user._id, query);
  }

  @Public()
  @Get('internal')
  async listMessagesInternal(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Query() query: InternalListChatMessagesQueryDto,
  ) {
    const expectedToken = config.CHAT_BATCH_INTERNAL_TOKEN;
    if (!expectedToken || internalToken !== expectedToken) {
      throw new UnauthorizedException('Invalid internal token');
    }

    return this.chatService.listMessages(query.userId, query);
  }
}
