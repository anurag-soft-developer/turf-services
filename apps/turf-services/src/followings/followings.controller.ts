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
import { FollowingsService } from './followings.service';
import { FollowingStatus } from './schemas/following.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  FollowingFilterDto,
  FriendsPaginationDto,
  ResolveFollowingRequestDto,
  SendFollowingRequestDto,
} from './dto/following.dto';
import { Types } from 'mongoose';

@Controller('followings')
@UseGuards(JwtAuthGuard)
export class FollowingsController {
  constructor(private readonly followingsService: FollowingsService) {}

  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  async sendRequest(
    @Body() dto: SendFollowingRequestDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.followingsService.sendRequest(userId.toString(), dto);
  }

  @Get()
  async list(
    @Query() filter: FollowingFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.followingsService.listMine(userId.toString(), filter);
  }

  @Get('friends')
  async listFriends(
    @Query() pagination: FriendsPaginationDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.followingsService.listFriends(userId.toString(), pagination);
  }

  @Get('users/:userId/followers')
  async listUserFollowers(
    @Param('userId') targetUserId: string,
    @Query() pagination: FriendsPaginationDto,
  ) {
    return this.followingsService.listUserFollowers(targetUserId, pagination);
  }

  @Get('users/:userId/following')
  async listUserFollowing(
    @Param('userId') targetUserId: string,
    @Query() pagination: FriendsPaginationDto,
  ) {
    return this.followingsService.listUserFollowing(targetUserId, pagination);
  }

  @Get('mutual-friends/:userId')
  async listMutualFriendsWith(
    @Param('userId') otherUserId: string,
    @Query() pagination: FriendsPaginationDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.followingsService.listMutualFriendsWith(
      userId.toString(),
      otherUserId,
      pagination,
    );
  }

  @Post(':id/resolve-request')
  async resolveRequest(
    @Param('id') id: string,
    @Body() dto: ResolveFollowingRequestDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    const status =
      dto.status === 'accepted'
        ? FollowingStatus.ACCEPTED
        : FollowingStatus.REJECTED;
    return this.followingsService.resolveRequest(
      id,
      userId.toString(),
      status,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async closeFollowing(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    await this.followingsService.closeFollowing(id, userId.toString());
  }
}
