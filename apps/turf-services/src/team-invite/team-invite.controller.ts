import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TeamInviteService } from './team-invite.service';
import {
  CreateTeamInviteDto,
  MyInvitesFilterDto,
  TeamInviteFilterDto,
} from './dto/team-invite.dto';
import { TeamInviteStatus } from './schemas/team-invite.schema';

@Controller('teams/:teamId/invites')
@UseGuards(JwtAuthGuard)
export class TeamInviteController {
  constructor(private readonly teamInviteService: TeamInviteService) {}

  @Post()
  async create(
    @Param('teamId') teamId: string,
    @Body() dto: CreateTeamInviteDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.create(teamId, userId.toString(), dto);
  }

  @Get()
  async list(
    @Param('teamId') teamId: string,
    @Query() filter: TeamInviteFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.listForTeam(
      teamId,
      userId.toString(),
      filter.status as TeamInviteStatus | undefined,
      filter.page,
      filter.limit,
    );
  }

  @Post(':inviteId/revoke')
  async revoke(
    @Param('teamId') teamId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.revoke(teamId, inviteId, userId.toString());
  }
}

@Controller('team-invites')
@UseGuards(JwtAuthGuard)
export class TeamInviteSelfController {
  constructor(private readonly teamInviteService: TeamInviteService) {}

  @Get('me')
  async listMine(
    @Query() filter: MyInvitesFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.listForInvitee(
      userId.toString(),
      filter.status as TeamInviteStatus | undefined,
      filter.page,
      filter.limit,
    );
  }

  @Post(':inviteId/accept')
  async accept(
    @Param('inviteId') inviteId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.accept(inviteId, userId.toString());
  }

  @Post(':inviteId/reject')
  async reject(
    @Param('inviteId') inviteId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.reject(inviteId, userId.toString());
  }
}
