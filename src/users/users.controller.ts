import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UpdateProfileDto } from '../auth/dto/auth.dto';
import type { IUser } from './interfaces/user.interface';
import { UsersService } from './users.service';
import {
  ReplaceFcmDevicesDto,
  UpsertFcmDeviceDto,
} from './dto/fcm-devices.dto';
import { LeaderboardQueryDto } from '../core/points/leaderboard.dto';
import {
  SearchUsersListDto,
  UpdateNotificationSettingsDto,
} from './dto/users.dto';
import { ApplyHostOnboardingDto } from './dto/host-onboarding.dto';
import { HostOnboardingService } from './host-onboarding.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly hostOnboardingService: HostOnboardingService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: IUser) {
    return UsersService.sanitizeProfile(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('host-onboarding')
  async getHostOnboardingStatus(@CurrentUser() user: IUser) {
    return this.hostOnboardingService.getStatus(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('host-onboarding/apply')
  async applyHostOnboarding(
    @CurrentUser() user: IUser,
    @Body() dto: ApplyHostOnboardingDto,
  ) {
    return this.hostOnboardingService.apply(user._id.toString(), user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: IUser,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<IUser> {
    return (await this.usersService.updateProfile(user._id.toString(), updateProfileDto)).toObject();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('notification-settings')
  async updateNotificationSettings(
    @CurrentUser() user: IUser,
    @Body() updateNotificationSettingsDto: UpdateNotificationSettingsDto,
  ) {
    const updatedUser = await this.usersService.updateNotificationSettings(
      user._id.toString(),
      updateNotificationSettingsDto,
    );

    return UsersService.sanitizeProfile(updatedUser);
  }

  /** Replaces the entire FCM device list (max 20). */
  @UseGuards(JwtAuthGuard)
  @Put('fcm-devices')
  async replaceFcmDevices(
    @CurrentUser() user: IUser,
    @Body() dto: ReplaceFcmDevicesDto,
  ) {
    const updated = await this.usersService.replaceFcmDevices(
      user._id.toString(),
      dto.devices,
    );
    return UsersService.sanitizeProfile(updated);
  }

  /** Merges or updates a single FCM device by `deviceKey`. */
  @UseGuards(JwtAuthGuard)
  @Patch('fcm-devices')
  async upsertFcmDevice(
    @CurrentUser() user: IUser,
    @Body() dto: UpsertFcmDeviceDto,
  ) {
    const updated = await this.usersService.upsertFcmDevice(user._id.toString(), dto);
    return UsersService.sanitizeProfile(updated);
  }

  @Public()
  @Get('leaderboard')
  async leaderboard(@Query() query: LeaderboardQueryDto) {
    return this.usersService.getLeaderboard(
      query.sportType,
      query.page,
      query.limit,
    );
  }

  @Public()
  @Get('profiles')
  async searchPublicProfiles(@Query() query: SearchUsersListDto) {
    return this.usersService.searchActivePublicProfiles(
      query.query,
      query.page,
      query.limit,
    );
  }

  @Public()
  @Get('profile/:identifier')
  async getPublicProfile(@Param('identifier') identifier: string) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isId = isValidObjectId(identifier);
    const isEmail = emailRegex.test(identifier);

    if (!isId && !isEmail) {
      throw new BadRequestException('Identifier must be a valid id or email');
    }

    const user = isId
      ? await this.usersService.findById(identifier)
      : await this.usersService.findByEmail(identifier);

    if (!user || !user.isActive) {
      return null;
    }

    return UsersService.sanitizePublicProfile(user);
  }
}
