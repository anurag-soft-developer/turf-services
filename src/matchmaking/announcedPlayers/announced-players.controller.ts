import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  AddAnnouncedPlayersDto,
  RemoveAnnouncedPlayersDto,
  UpdateAnnouncedPlayersDto,
} from './dto/announced-players.dto';
import { AnnouncedPlayersService } from './announced-players.service';

@Controller('matchmaking')
@UseGuards(JwtAuthGuard)
export class AnnouncedPlayersController {
  constructor(
    private readonly announcedPlayersService: AnnouncedPlayersService,
  ) {}

  @Get(':matchId/announced-players')
  async getAnnouncedPlayersForTeam(
    @Param('matchId') matchId: string,
    @Query('actorTeamId') actorTeamId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.announcedPlayersService.getAnnouncedPlayersForTeam(
      matchId,
      userId.toString(),
      actorTeamId,
    );
  }

  @Delete(':matchId/announced-players')
  async removeAnnouncedPlayers(
    @Param('matchId') matchId: string,
    @Body() dto: RemoveAnnouncedPlayersDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.announcedPlayersService.removeAnnouncedPlayers(
      matchId,
      userId.toString(),
      dto,
    );
  }

  @Post(':matchId/announced-players')
  async addAnnouncedPlayers(
    @Param('matchId') matchId: string,
    @Body() dto: AddAnnouncedPlayersDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.announcedPlayersService.addAnnouncedPlayers(
      matchId,
      userId.toString(),
      dto,
    );
  }

  @Patch(':matchId/announced-players')
  async updateAnnouncedPlayers(
    @Param('matchId') matchId: string,
    @Body() dto: UpdateAnnouncedPlayersDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.announcedPlayersService.updateAnnouncedPlayers(
      matchId,
      userId.toString(),
      dto,
    );
  }
}
