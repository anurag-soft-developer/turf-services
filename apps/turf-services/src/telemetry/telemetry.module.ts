import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { ClientLog, ClientLogSchema } from './schemas/client-log.schema';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: ClientLog.name, schema: ClientLogSchema },
    ]),
  ],
  controllers: [TelemetryController],
  providers: [TelemetryService, OptionalJwtAuthGuard],
})
export class TelemetryModule {}
