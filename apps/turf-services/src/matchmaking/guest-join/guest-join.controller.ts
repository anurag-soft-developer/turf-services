import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { GuestJoinDto, UpdateGuestJoinSettingsDto } from './dto/guest-join.dto';
import { GuestJoinService } from './guest-join.service';

@Controller('matchmaking')
@UseGuards(JwtAuthGuard)
export class GuestJoinController {
  constructor(private readonly guestJoinService: GuestJoinService) {}

  @Get(':matchId/guest-join')
  async getStatus(
    @Param('matchId') matchId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.guestJoinService.getStatus(matchId, userId.toString());
  }

  @Patch(':matchId/guest-join/settings')
  async updateSettings(
    @Param('matchId') matchId: string,
    @Body() dto: UpdateGuestJoinSettingsDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.guestJoinService.updateSettings(
      matchId,
      userId.toString(),
      dto,
    );
  }

  /** Joins, or switches sides when the caller has already joined. */
  @Post(':matchId/guest-join')
  async join(
    @Param('matchId') matchId: string,
    @Body() dto: GuestJoinDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.guestJoinService.join(matchId, userId.toString(), dto);
  }

  @Delete(':matchId/guest-join')
  async leave(
    @Param('matchId') matchId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.guestJoinService.leave(matchId, userId.toString());
  }
}
