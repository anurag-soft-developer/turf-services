import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurfService } from './turf.service';
import { TurfController } from './turf.controller';
import { Turf, TurfSchema } from './schemas/turf.schema';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Turf.name, schema: TurfSchema }]),
    UsersModule,
  ],
  controllers: [TurfController],
  providers: [TurfService],
  exports: [TurfService],
})
export class TurfModule {}