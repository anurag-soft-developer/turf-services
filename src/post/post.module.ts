import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Media, MediaSchema } from './schemas/media.schema';
import { ContentPost, ContentPostSchema } from './schemas/content-post.schema';
import { PostService } from './post.service';
import { PostController } from './post.controller';
import { MediaController } from './media.controller';
import { TeamModule } from '../team/team.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Media.name, schema: MediaSchema },
      { name: ContentPost.name, schema: ContentPostSchema },
    ]),
    TeamModule,
  ],
  controllers: [PostController, MediaController],
  providers: [PostService],
  exports: [PostService],
})
export class PostModule {}
