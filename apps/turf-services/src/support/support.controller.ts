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
  AddSupportInternalNoteDto,
  AddSupportReplyDto,
  CreateSupportQueryDto,
  SupportQueryFilterDto,
  UpdateSupportQueryStatusDto,
} from './dto/support.dto';
import { SupportService } from './support.service';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('queries')
  async createQuery(
    @CurrentUser() user: IUser,
    @Body() dto: CreateSupportQueryDto,
  ) {
    return this.supportService.createQuery(user._id.toString(), dto);
  }

  @Get('queries/mine')
  async listMine(
    @CurrentUser() user: IUser,
    @Query() filter: SupportQueryFilterDto,
  ) {
    return this.supportService.listMine(user._id.toString(), filter);
  }

  @Get('admin/queries')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async listAll(@Query() filter: SupportQueryFilterDto) {
    return this.supportService.listAll(filter);
  }

  @Get('queries/:id')
  async getById(@Param('id') id: string, @CurrentUser() user: IUser) {
    return this.supportService.getById(
      id,
      user._id.toString(),
      user.role,
    );
  }

  @Post('queries/:id/replies')
  async addReply(
    @Param('id') id: string,
    @CurrentUser() user: IUser,
    @Body() dto: AddSupportReplyDto,
  ) {
    return this.supportService.addReply(
      id,
      user._id.toString(),
      user.role,
      dto,
    );
  }

  @Post('queries/:id/internal-notes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async addInternalNote(
    @Param('id') id: string,
    @CurrentUser() user: IUser,
    @Body() dto: AddSupportInternalNoteDto,
  ) {
    return this.supportService.addInternalNote(
      id,
      user._id.toString(),
      dto,
    );
  }

  @Patch('admin/queries/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: IUser,
    @Body() dto: UpdateSupportQueryStatusDto,
  ) {
    return this.supportService.updateStatus(id, user._id.toString(), dto);
  }
}
