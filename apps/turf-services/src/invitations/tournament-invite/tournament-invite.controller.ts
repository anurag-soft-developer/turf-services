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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  CreateTournamentInvitationDto,
  ListTournamentInvitationsDto,
} from './dto/tournament-invite.dto';
import { TournamentInviteService } from './tournament-invite.service';

@Controller('tournaments/:tournamentId/invitations')
@UseGuards(JwtAuthGuard)
export class TournamentInviteController {
  constructor(private readonly tournamentInvites: TournamentInviteService) {}

  @Public()
  @Get()
  list(
    @Param('tournamentId') tournamentId: string,
    @Query() query: ListTournamentInvitationsDto,
  ) {
    return this.tournamentInvites.list(tournamentId, query);
  }

  @Post()
  create(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('tournamentId') tournamentId: string,
    @Body() dto: CreateTournamentInvitationDto,
  ) {
    return this.tournamentInvites.create(userId.toString(), tournamentId, dto);
  }

  @Post(':invitationId/accept')
  accept(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('tournamentId') tournamentId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.tournamentInvites.accept(
      userId.toString(),
      tournamentId,
      invitationId,
    );
  }

  @Post(':invitationId/decline')
  decline(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('tournamentId') tournamentId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.tournamentInvites.decline(
      userId.toString(),
      tournamentId,
      invitationId,
    );
  }

  @Post(':invitationId/revoke')
  revoke(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('tournamentId') tournamentId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.tournamentInvites.revoke(
      userId.toString(),
      tournamentId,
      invitationId,
    );
  }

  @Post(':invitationId/withdraw')
  withdraw(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('tournamentId') tournamentId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.tournamentInvites.withdraw(
      userId.toString(),
      tournamentId,
      invitationId,
    );
  }
}
