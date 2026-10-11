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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { TeamInviteService } from './team-invite.service';
import {
  CreateTeamInviteDto,
  TeamInviteFilterDto,
} from './dto/team-invite.dto';
import { InvitationStatus } from '../invitation.constants';

@Controller('teams/:teamId/invitations')
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
      filter.status as InvitationStatus | undefined,
      filter.page,
      filter.limit,
    );
  }

  @Post(':invitationId/revoke')
  async revoke(
    @Param('teamId') teamId: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.revoke(
      teamId,
      invitationId,
      userId.toString(),
    );
  }
}
