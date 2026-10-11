import {
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
import { InvitationKind, InvitationStatus } from './invitation.constants';
import { MyInvitesFilterDto } from './team-invite/dto/team-invite.dto';
import { TeamInviteService } from './team-invite/team-invite.service';

@Controller('invitations')
@UseGuards(JwtAuthGuard)
export class InvitationSelfController {
  constructor(private readonly teamInviteService: TeamInviteService) {}

  @Get('me')
  async listMine(
    @Query() filter: MyInvitesFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.listForInvitee(
      userId.toString(),
      filter.status as InvitationStatus | undefined,
      filter.page,
      filter.limit,
      filter.kind as InvitationKind | undefined,
    );
  }

  @Post(':invitationId/accept')
  async accept(
    @Param('invitationId') invitationId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.accept(invitationId, userId.toString());
  }

  @Post(':invitationId/decline')
  async decline(
    @Param('invitationId') invitationId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamInviteService.decline(invitationId, userId.toString());
  }
}
