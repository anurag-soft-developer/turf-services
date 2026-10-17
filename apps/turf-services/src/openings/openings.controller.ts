import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateOpeningDto,
  OpeningFilterDto,
  OpeningTargetQueryDto,
  UpdateOpeningDto,
} from './dto/opening.dto';
import { OpeningsService } from './openings.service';
import { OpeningType } from './schemas/opening.schema';

@Controller('openings')
export class OpeningsController {
  constructor(private readonly openingsService: OpeningsService) {}

  @Get()
  findMany(
    @Query() query: OpeningFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.openingsService.findMany(query, userId.toString());
  }

  @Get('mine')
  findMine(@CurrentUser('_id') userId: Types.ObjectId) {
    return this.openingsService.findMine(userId.toString());
  }

  @Get('by-target')
  async findCurrent(
    @Query() query: OpeningTargetQueryDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    const opening = await this.openingsService.findCurrent(
      query.type as OpeningType,
      query.type === OpeningType.TEAM
        ? query.teamId!
        : query.tournamentId!,
      userId.toString(),
    );
    return { opening };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateOpeningDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.openingsService.create(userId.toString(), dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOpeningDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.openingsService.update(userId.toString(), id, dto);
  }
}
