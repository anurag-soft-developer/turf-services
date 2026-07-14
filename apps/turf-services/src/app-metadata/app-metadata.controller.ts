import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
  Patch,
} from '@nestjs/common';
import { AppMetadataService } from './app-metadata.service';
import {
  CreateAppMetadataDto,
  UpdateAppMetadataDto,
} from './dto/app-metadata.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Roles, UserRole } from '../auth/decorators/roles.decorator';

@Controller('app-metadata')
export class AppMetadataController {
  constructor(private readonly appMetadataService: AppMetadataService) {}

  @Get()
  @Public()
  async getMetadata() {
    const metadata = await this.appMetadataService.findOne();

    return metadata;
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createMetadata(@Body() createMetadataDto: CreateAppMetadataDto) {
    const metadata =
      await this.appMetadataService.createOrUpdate(createMetadataDto);

    return metadata;
  }

  @Patch()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateMetadata(@Body() updateMetadataDto: UpdateAppMetadataDto) {
    const metadata =
      await this.appMetadataService.createOrUpdate(updateMetadataDto);

    return metadata;
  }
}
