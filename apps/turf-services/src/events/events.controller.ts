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
import { EventsService } from './events.service';
import { EventApprovalService } from './event-approvals/event-approval.service';
import {
  CreateEventDto,
  SearchEventDto,
  UpdateEventDto,
} from './dto/events.dto';
import { ReviewEventDto } from './event-approvals/dto/event-approval.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as UserInterface from '../users/interfaces/user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Roles, UserRole } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly eventApprovalService: EventApprovalService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateEventDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventsService.create(user._id, dto);
  }

  @Get('mine')
  async findMine(
    @Query() query: SearchEventDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventsService.findMine(user._id, query);
  }

  @Get('mine/stats')
  async findMineStats(@CurrentUser() user: UserInterface.IUser) {
    return this.eventsService.findMineStats(user._id);
  }

  @Get('admin/pending')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async listPending(@Query() query: SearchEventDto) {
    return this.eventApprovalService.listPendingForAdmin(query);
  }

  @Patch('admin/:eventId/review')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async reviewEvent(
    @Param('eventId') eventId: string,
    @CurrentUser() user: UserInterface.IUser,
    @Body() dto: ReviewEventDto,
  ) {
    return this.eventApprovalService.reviewEvent(eventId, user._id, dto);
  }

  @Public()
  @Get('public')
  async findPublic(@Query() query: SearchEventDto) {
    return this.eventsService.findPublic(query);
  }

  @Public()
  @Get('public/:slug')
  async findPublicBySlug(@Param('slug') slug: string) {
    return this.eventsService.findPublicBySlug(slug);
  }

  @Post(':id/submit')
  async submitForApproval(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventApprovalService.submitForApproval(id, user._id);
  }

  @Post(':id/withdraw')
  async withdrawSubmission(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventApprovalService.withdrawSubmission(id, user._id);
  }

  @Patch(':id/close')
  async closeEvent(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventsService.closeEvent(id, {
      userId: user._id,
      role: user.role,
    });
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventsService.findById(id, {
      userId: user._id,
      role: user.role,
    });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventsService.update(id, dto, {
      userId: user._id,
      role: user.role,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    await this.eventsService.delete(id, {
      userId: user._id,
      role: user.role,
    });
  }
}
