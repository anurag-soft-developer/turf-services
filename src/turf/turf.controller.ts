import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { TurfService } from './turf.service';
import { TurfApprovalService } from './turf-approval.service';
import { CreateTurfDto, UpdateTurfDto } from './dto/turf.dto';
import { SearchTurfDto } from './dto/turf.filter.dto';
import { ReviewTurfDto } from './dto/turf-approval.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as UserInterface from '../users/interfaces/user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, UserRole } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('turf')
@UseGuards(JwtAuthGuard)
export class TurfController {
  constructor(
    private readonly turfService: TurfService,
    private readonly turfApprovalService: TurfApprovalService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createTurfDto: CreateTurfDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    const turf = await this.turfService.create(user._id, createTurfDto);
    return turf;
  }

  @Get()
  async findAll(@Query() query: SearchTurfDto) {
    const turfs = await this.turfService.searchFeedTurfs(query);
    return turfs;
  }

  @Get('/owner/my')
  async findMyTurfs(
    @Query() query: SearchTurfDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    const turfs = await this.turfService.searchTurfs({
      ...query,
      postedBy: user._id,
    });
    return turfs;
  }

  @Get('/stats')
  async getStats() {
    const stats = await this.turfService.getStats();
    return stats;
  }

  @Get('/admin/pending')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async listPending(@Query() query: SearchTurfDto) {
    return this.turfApprovalService.listPendingForAdmin(query);
  }

  @Post(':id/submit')
  async submitForApproval(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.turfApprovalService.submitForApproval(id, user._id);
  }

  @Post(':id/withdraw')
  async withdrawSubmission(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.turfApprovalService.withdrawSubmission(id, user._id);
  }

  @Patch('/admin/:id/review')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async reviewTurf(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
    @Body() dto: ReviewTurfDto,
  ) {
    return this.turfApprovalService.reviewTurf(id, user._id, dto);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    const turf = await this.turfService.findById(id, {
      userId: user._id,
      role: user.role,
    });
    return turf;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateTurfDto: UpdateTurfDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return await this.turfService.update(id, updateTurfDto, {
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
    await this.turfService.delete(id, {
      userId: user._id,
      role: user.role,
    });
    return {
      success: true,
      message: 'Turf deleted successfully',
    };
  }
}
