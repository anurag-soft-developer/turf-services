import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller';
import { ScoringGateway } from './scoring.gateway';

@Module({
  controllers: [ScoringController],
  providers: [ScoringGateway],
  exports: [ScoringGateway],
})
export class ScoringModule {}
