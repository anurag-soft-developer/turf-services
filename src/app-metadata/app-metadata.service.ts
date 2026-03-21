import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AppMetadata,
  AppMetadataDocument,
} from './schemas/app-metadata.schema';
import {
  CreateAppMetadataDto,
  UpdateAppMetadataDto,
} from './dto/app-metadata.dto';

@Injectable()
export class AppMetadataService {
  constructor(
    @InjectModel(AppMetadata.name)
    private appMetadataModel: Model<AppMetadataDocument>,
  ) {}

  async createOrUpdate(
    createOrUpdateDto: CreateAppMetadataDto | UpdateAppMetadataDto,
  ): Promise<AppMetadataDocument> {
    if (createOrUpdateDto.sports) {
      createOrUpdateDto.sports = [
        ...new Set(createOrUpdateDto.sports.map((sport) => sport.trim())),
      ];
    }

    // Since there should only be one metadata document, we'll use upsert
    const metadata = await this.appMetadataModel.findOneAndUpdate(
      {}, // Empty filter to match any document
      createOrUpdateDto,
      {
        new: true,
        upsert: true, // Create if doesn't exist
        runValidators: true,
      },
    );

    return metadata;
  }

  async findOne(): Promise<AppMetadataDocument> {
    let metadata = await this.appMetadataModel.findOne();

    if (!metadata) {
      // Create default metadata if none exists
      metadata = new this.appMetadataModel({
        sports: [],
      });
      await metadata.save();
    }

    return metadata;
  }
}
