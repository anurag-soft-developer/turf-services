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
import { Types } from 'mongoose';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  BracketWinnerDto,
  AddOrganizerDto,
  CreateTournamentDto,
  ListTournamentsDto,
  QualifierPickDto,
  UpdateFixtureTeamsDto,
  UpdateTournamentDto,
} from './dto/tournament.dto';
import { TournamentService } from './tournament.service';

@Controller('tournaments')
@UseGuards(JwtAuthGuard)
export class TournamentController {
  constructor(private readonly tournamentService: TournamentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() dto: CreateTournamentDto,
  ) {
    return this.tournamentService.create(userId.toString(), dto);
  }

  @Get('open')
  listOpen(@Query() query: ListTournamentsDto) {
    return this.tournamentService.listOpen(query);
  }

  @Get('mine')
  listMine(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Query() query: ListTournamentsDto,
  ) {
    return this.tournamentService.listMine(userId.toString(), query);
  }

  @Get('acting-teams')
  actingTeams(@CurrentUser('_id') userId: Types.ObjectId) {
    return this.tournamentService.actingTeams(userId.toString());
  }

  @Public()
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.tournamentService.getOne(id);
  }

  @Post(':id/organizers')
  addOrganizer(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
    @Body() dto: AddOrganizerDto,
  ) {
    return this.tournamentService.addOrganizer(userId.toString(), id, dto);
  }

  @Delete(':id/organizers/:userId')
  removeOrganizer(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.tournamentService.removeOrganizer(
      userId.toString(),
      id,
      targetUserId,
    );
  }

  @Patch(':id')
  updateDraft(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
    @Body() dto: UpdateTournamentDto,
  ) {
    return this.tournamentService.updateDraft(userId.toString(), id, dto);
  }

  @Post(':id/publish')
  publish(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
  ) {
    return this.tournamentService.publish(userId.toString(), id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser('_id') userId: Types.ObjectId, @Param('id') id: string) {
    return this.tournamentService.cancel(userId.toString(), id);
  }

  @Delete(':id')
  async remove(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
  ) {
    await this.tournamentService.remove(userId.toString(), id);
    return {
      success: true,
      message: 'Tournament deleted successfully',
    };
  }

  @Post(':id/lock-roster')
  lockRoster(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
  ) {
    return this.tournamentService.lockRoster(userId.toString(), id);
  }

  @Post(':id/entries/:invitationId/remove')
  removeAcceptedTeam(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.tournamentService.removeAcceptedTeam(
      userId.toString(),
      id,
      invitationId,
    );
  }

  @Post(':id/draw')
  generateDraw(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
  ) {
    return this.tournamentService.generateDraw(userId.toString(), id);
  }

  @Patch(':id/fixtures/:matchId/teams')
  updateFixtureTeams(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: UpdateFixtureTeamsDto,
  ) {
    return this.tournamentService.updateFixtureTeams(
      userId.toString(),
      id,
      matchId,
      dto,
    );
  }

  @Post(':id/fixtures/:matchId/bracket-winner')
  pickBracketWinner(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: BracketWinnerDto,
  ) {
    return this.tournamentService.pickBracketWinner(
      userId.toString(),
      id,
      matchId,
      dto,
    );
  }

  @Post(':id/qualifiers')
  pickQualifiers(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Param('id') id: string,
    @Body() dto: QualifierPickDto,
  ) {
    return this.tournamentService.pickQualifiers(userId.toString(), id, dto);
  }

  @Public()
  @Get(':id/fixtures')
  listFixtures(@Param('id') id: string) {
    return this.tournamentService.listFixtures(id);
  }

  @Public()
  @Get(':id/table')
  getTable(@Param('id') id: string) {
    return this.tournamentService.getTable(id);
  }
}
