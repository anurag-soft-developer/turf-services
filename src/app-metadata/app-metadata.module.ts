import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppMetadataService } from './app-metadata.service';
import { AppMetadataController } from './app-metadata.controller';
import {
  AppMetadata,
  AppMetadataSchema,
} from './schemas/app-metadata.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppMetadata.name, schema: AppMetadataSchema },
    ]),
  ],
  controllers: [AppMetadataController],
  providers: [AppMetadataService],
  exports: [AppMetadataService],
})
export class AppMetadataModule {}