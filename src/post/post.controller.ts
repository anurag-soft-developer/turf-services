import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PostService } from './post.service';
import { CreatePostDto, PostFilterDto, UpdatePostDto } from './dto/post.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Types } from 'mongoose';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreatePostDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.postService.create(userId.toString(), dto);
  }

  @Get()
  async findMany(
    @Query() filter: PostFilterDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.postService.findMany(userId.toString(), filter);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.postService.findById(id, userId.toString());
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.postService.update(id, userId.toString(), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    await this.postService.remove(id, userId.toString());
  }
}
