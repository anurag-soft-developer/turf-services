import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PostService } from './post.service';
import { CreateMediaDto } from './dto/post.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Types } from 'mongoose';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly postService: PostService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: CreateMediaDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.postService.registerMedia(userId.toString(), dto);
  }
}
