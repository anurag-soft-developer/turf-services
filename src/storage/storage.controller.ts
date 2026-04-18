import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Types } from 'mongoose';
import {
  DirectUploadBodyDto,
  UploadUrlRequestDto,
} from '../post/dto/media-upload.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { DeleteObjectsBodyDto } from './dto/delete-objects.dto';
import { StorageService } from './storage.service';

type UploadedFilePayload = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

@Controller('storage')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload-url')
  @HttpCode(HttpStatus.CREATED)
  async createUploadUrl(
    @Body() dto: UploadUrlRequestDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.storageService.createSignedUploadUrl({
      userId: userId.toString(),
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      purpose: dto.purpose,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Post('upload-direct')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @HttpCode(HttpStatus.CREATED)
  async uploadDirect(
    @UploadedFile() file: UploadedFilePayload,
    @Body() dto: DirectUploadBodyDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.storageService.uploadBuffer({
      userId: userId.toString(),
      fileName: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
      purpose: dto.purpose,
    });
  }

  @Delete('objects')
  @HttpCode(HttpStatus.OK)
  async deleteObjects(
    @Body() dto: DeleteObjectsBodyDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.storageService.deleteObjects({
      userId: userId.toString(),
      objectKeys: dto.objectKeys,
    });
  }
}
