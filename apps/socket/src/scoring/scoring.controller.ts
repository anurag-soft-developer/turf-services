import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { scoringUpdatePayloadSchema } from '../../../../libs';
import { config } from '../core/config/env.config';
import { ScoringGateway } from './scoring.gateway';

@Controller('internal/scoring')
export class ScoringController {
  constructor(private readonly scoringGateway: ScoringGateway) {}

  @Post('dispatch')
  dispatch(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = config.INTERNAL_TOKEN;
    if (!expected || internalToken !== expected) {
      throw new UnauthorizedException('Invalid internal token');
    }
    const parsed = scoringUpdatePayloadSchema.parse(body);
    this.scoringGateway.pushToSession(parsed);
    return { ok: true };
  }
}
