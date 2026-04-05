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
import { TeamService } from './team.service';
import {
  CreateTeamDto,
  TeamFilterDto,
  PromoteOwnerDto,
  UpdateTeamDto,
} from './dto/team.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Types } from 'mongoose';

@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateTeamDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamService.create(userId.toString(), dto);
  }

  @Get()
  async findMany(
    @Query() filter: TeamFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamService.findMany(userId.toString(), filter);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamService.findById(id, userId.toString());
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamService.update(id, userId.toString(), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    await this.teamService.delete(id, userId.toString());
  }

  @Post(':id/owners')
  async promoteOwner(
    @Param('id') id: string,
    @Body() dto: PromoteOwnerDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamService.promoteOwner(id, userId.toString(), dto);
  }

  @Delete(':id/owners/:userId')
  async demoteOwner(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamService.demoteOwner(id, userId.toString(), targetUserId);
  }
}
