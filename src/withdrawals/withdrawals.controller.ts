import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles, UserRole } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { IUser } from '../users/interfaces/user.interface';
import {
  AddWithdrawalAttachmentsDto,
  AddWithdrawalCommentDto,
  CreateWithdrawalRequestDto,
  UpdateWithdrawalStatusDto,
  WithdrawalFilterDto,
} from './dto/withdrawal.dto';
import { WithdrawalsService } from './withdrawals.service';

@Controller('withdrawals')
@UseGuards(JwtAuthGuard)
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Post('request')
  async createRequest(
    @CurrentUser() user: IUser,
    @Body() dto: CreateWithdrawalRequestDto,
  ) {
    return this.withdrawalsService.createRequest(user._id.toString(), dto);
  }

  @Get('my-requests')
  async listMine(@CurrentUser() user: IUser, @Query() filter: WithdrawalFilterDto) {
    return this.withdrawalsService.listMine(user._id.toString(), filter);
  }

  @Get('admin/requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async listAll(@Query() filter: WithdrawalFilterDto) {
    return this.withdrawalsService.listAll(filter);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: IUser) {
    return this.withdrawalsService.getById(
      id,
      user._id.toString(),
      user.role,
    );
  }

  @Post(':id/cancel')
  async cancelRequest(@Param('id') id: string, @CurrentUser() user: IUser) {
    return this.withdrawalsService.cancelRequest(id, user._id.toString());
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async addComment(
    @Param('id') id: string,
    @CurrentUser() user: IUser,
    @Body() dto: AddWithdrawalCommentDto,
  ) {
    return this.withdrawalsService.addComment(
      id,
      user._id.toString(),
      dto,
    );
  }

  @Post(':id/attachments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async addAttachments(
    @Param('id') id: string,
    @Body() dto: AddWithdrawalAttachmentsDto,
  ) {
    return this.withdrawalsService.addAttachments(id, dto);
  }

  @Patch('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: IUser,
    @Body() dto: UpdateWithdrawalStatusDto,
  ) {
    return this.withdrawalsService.updateStatus(id, user._id.toString(), dto);
  }
}
