import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LocalMatchService } from './local-match.service';
import {
  CreateLocalMatchDto,
  LocalMatchFilterDto,
  PromoteHostDto,
  UpdateLocalMatchDto,
} from './dto/local-match.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Types } from 'mongoose';

@Controller('local-matches')
@UseGuards(JwtAuthGuard)
export class LocalMatchController {
  constructor(private readonly localMatchService: LocalMatchService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateLocalMatchDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.localMatchService.create(userId.toString(), dto);
  }

  @Get()
  async findMany(
    @Query() filter: LocalMatchFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.localMatchService.findMany(userId.toString(), filter);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.localMatchService.findById(id, userId.toString());
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLocalMatchDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.localMatchService.update(id, userId.toString(), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    await this.localMatchService.delete(id, userId.toString());
  }

  @Post(':id/join')
  async join(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.localMatchService.join(id, userId.toString());
  }

  @Post(':id/join-requests/:requestId/accept')
  async acceptJoin(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.localMatchService.acceptJoinRequest(id, requestId, userId.toString());
  }

  @Post(':id/join-requests/:requestId/reject')
  async rejectJoin(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.localMatchService.rejectJoinRequest(id, requestId, userId.toString());
  }

  @Post(':id/hosts')
  async promoteHost(
    @Param('id') id: string,
    @Body() dto: PromoteHostDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.localMatchService.promoteHost(id, userId.toString(), dto);
  }

  @Delete(':id/hosts/:userId')
  async demoteHost(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.localMatchService.demoteHost(id, userId.toString(), targetUserId);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    await this.localMatchService.leave(id, userId.toString());
  }
}
