import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TelemetryBatchDto } from './dto/telemetry.dto';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { TelemetryService } from './telemetry.service';

@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('batch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ingestBatch(
    @CurrentUser('_id') userId: Types.ObjectId | undefined,
    @Body() dto: TelemetryBatchDto,
  ): Promise<void> {
    await this.telemetryService.ingestBatch(
      userId ? userId.toString() : null,
      dto.events,
    );
  }
}
