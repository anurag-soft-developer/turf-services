import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
  SearchUsersListDto,
  UpdateNotificationSettingsDto,
} from './dto/users.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: IUser) {
    return UsersService.sanitizeProfile(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: IUser,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<IUser> {
    return (await this.usersService.updateProfile(user._id, updateProfileDto)).toObject();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('notification-settings')
  async updateNotificationSettings(
    @CurrentUser() user: IUser,
    @Body() updateNotificationSettingsDto: UpdateNotificationSettingsDto,
  ) {
    const updatedUser = await this.usersService.updateById(
      user._id,
      updateNotificationSettingsDto,
    );

    return UsersService.sanitizeProfile(updatedUser);
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
