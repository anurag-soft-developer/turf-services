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
import { TeamMemberService } from './team-member.service';
import {
  MyMembershipsFilterDto,
  SuspendTeamMemberDto,
  TeamMemberFilterDto,
  UpdateTeamMemberDto,
} from './dto/team-member.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Types } from 'mongoose';
import { TeamMemberStatus } from './schemas/team-member.schema';

@Controller('teams/:teamId/members')
@UseGuards(JwtAuthGuard)
export class TeamMemberController {
  constructor(private readonly teamMemberService: TeamMemberService) {}

  @Post('join')
  async join(
    @Param('teamId') teamId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamMemberService.join(teamId, userId.toString());
  }

  @Get()
  async list(
    @Param('teamId') teamId: string,
    @Query() filter: TeamMemberFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamMemberService.findManyForTeam(
      teamId,
      userId.toString(),
      filter.status as TeamMemberStatus | undefined,
      filter.page,
      filter.limit,
    );
  }

  @Patch(':membershipId')
  async updateMember(
    @Param('teamId') teamId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateTeamMemberDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamMemberService.updateMember(
      teamId,
      membershipId,
      userId.toString(),
      dto,
    );
  }

  @Post(':membershipId/accept')
  async accept(
    @Param('teamId') teamId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamMemberService.acceptRequest(
      teamId,
      membershipId,
      userId.toString(),
    );
  }

  @Post(':membershipId/reject')
  async reject(
    @Param('teamId') teamId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamMemberService.rejectRequest(
      teamId,
      membershipId,
      userId.toString(),
    );
  }

  @Post('leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(
    @Param('teamId') teamId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    await this.teamMemberService.resign(teamId, userId.toString());
    return { message: 'You have left the team', success: true };
  }

  @Delete('users/:targetUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('teamId') teamId: string,
    @Param('targetUserId') targetUserId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    await this.teamMemberService.removeMember(
      teamId,
      targetUserId,
      userId.toString(),
    );
  }

  @Post(':membershipId/suspend')
  async suspend(
    @Param('teamId') teamId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: SuspendTeamMemberDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamMemberService.suspend(
      teamId,
      membershipId,
      userId.toString(),
      dto,
    );
  }

  @Post(':membershipId/unsuspend')
  async unsuspend(
    @Param('teamId') teamId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamMemberService.unsuspend(
      teamId,
      membershipId,
      userId.toString(),
    );
  }
}

@Controller('team-members')
@UseGuards(JwtAuthGuard)
export class TeamMembershipSelfController {
  constructor(private readonly teamMemberService: TeamMemberService) {}

  @Get('me')
  async myMemberships(
    @Query() filter: MyMembershipsFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.teamMemberService.findMyMemberships(
      userId.toString(),
      filter.status as TeamMemberStatus | undefined,
      filter.page,
      filter.limit,
    );
  }
}
