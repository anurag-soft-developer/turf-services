import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConnectionsService } from './connections.service';
import { ConnectionStatus } from './schemas/connection.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  ConnectionFilterDto,
  ResolveConnectionRequestDto,
  SendConnectionRequestDto,
} from './dto/connection.dto';
import { Types } from 'mongoose';

@Controller('connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  async sendRequest(
    @Body() dto: SendConnectionRequestDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.connectionsService.sendRequest(userId.toString(), dto);
  }

  @Get()
  async list(
    @Query() filter: ConnectionFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.connectionsService.listMine(userId.toString(), filter);
  }

  @Post(':id/resolve-request')
  async resolveRequest(
    @Param('id') id: string,
    @Body() dto: ResolveConnectionRequestDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    const status =
      dto.status === 'accepted'
        ? ConnectionStatus.ACCEPTED
        : ConnectionStatus.REJECTED;
    return this.connectionsService.resolveRequest(id, userId.toString(), status);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async closeConnection(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    await this.connectionsService.closeConnection(id, userId.toString());
  }

}
