import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CancelNegotiationDto,
  DecideSlotProposalDto,
  DecideTurfProposalDto,
  FinalizeScheduleDto,
  ListNegotiationsFilterDto,
  UpdateTeamMatchDto,
  ProposeScheduleDto,
  RecordMatchResultDto,
  RespondMatchRequestDto,
  SendMatchRequestDto,
} from './dto/matchmaking.dto';
import { MatchmakingService } from './matchmaking.service';

@Controller('matchmaking')
@UseGuards(JwtAuthGuard)
export class MatchmakingController {
  constructor(private readonly matchmakingService: MatchmakingService) {}

  @Post('requests')
  async sendRequest(
    @Body() dto: SendMatchRequestDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.sendRequest(userId.toString(), dto);
  }

  @Get('requests')
  async listRequests(
    @Query() dto: ListNegotiationsFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.listRequests(userId.toString(), dto);
  }

  @Post('requests/:id/respond')
  async respond(
    @Param('id') id: string,
    @Body() dto: RespondMatchRequestDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.respond(id, userId.toString(), dto);
  }

  @Post('requests/:id/propose-schedule')
  async proposeSchedule(
    @Param('id') id: string,
    @Body() dto: ProposeScheduleDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.proposeSchedule(id, userId.toString(), dto);
  }

  @Post('requests/:id/slots/decide')
  async decideSlotProposal(
    @Param('id') id: string,
    @Body() dto: DecideSlotProposalDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.decideSlotProposal(id, userId.toString(), dto);
  }

  @Post('requests/:id/turfs/decide')
  async decideTurfProposal(
    @Param('id') id: string,
    @Body() dto: DecideTurfProposalDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.decideTurfProposal(id, userId.toString(), dto);
  }

  @Post('requests/:id/finalize-schedule')
  async finalizeSchedule(
    @Param('id') id: string,
    @Body() dto: FinalizeScheduleDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.finalizeSchedule(id, userId.toString(), dto);
  }

  @Post('requests/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelNegotiationDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.cancel(id, userId.toString(), dto);
  }

  @Post('requests/:id/match-result')
  async recordMatchResult(
    @Param('id') id: string,
    @Body() dto: RecordMatchResultDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.recordMatchResult(id, userId.toString(), dto);
  }

  /** Patch booking, notes, optional `slot` / `turfId` (new accepted proposals; ids generated server-side). */
  @Patch('requests/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTeamMatchDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.matchmakingService.update(id, userId.toString(), dto);
  }
}
