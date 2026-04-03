import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LocalMatch, LocalMatchSchema } from './schemas/local-match.schema';
import { LocalMatchService } from './local-match.service';
import { LocalMatchController } from './local-match.controller';
import { ConnectionsModule } from '../connections/connections.module';
import { TurfModule } from '../turf/turf.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LocalMatch.name, schema: LocalMatchSchema },
    ]),
    ConnectionsModule,
    TurfModule,
  ],
  controllers: [LocalMatchController],
  providers: [LocalMatchService],
  exports: [LocalMatchService],
})
export class LocalMatchModule {}
