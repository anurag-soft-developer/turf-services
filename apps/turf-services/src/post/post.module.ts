import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContentPost, ContentPostSchema } from './schemas/content-post.schema';
import { PostService } from './post.service';
import { PostController } from './post.controller';
import { TeamModule } from '../team/team.module';
import { TeamMemberModule } from '../team-member/team-member.module';
import { StorageModule } from '../storage/storage.module';
import { Team, TeamSchema } from '../team/schemas/team.schema';
import { Turf, TurfSchema } from '../turf/schemas/turf.schema';
import {
  TeamMatch,
  TeamMatchSchema,
} from '../matchmaking/schemas/team-match.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContentPost.name, schema: ContentPostSchema },
      { name: TeamMatch.name, schema: TeamMatchSchema },
      { name: Team.name, schema: TeamSchema },
      { name: Turf.name, schema: TurfSchema },
    ]),
    forwardRef(() => TeamModule),
    forwardRef(() => TeamMemberModule),
    StorageModule,
  ],
  controllers: [PostController],
  providers: [PostService],
  exports: [PostService],
})
export class PostModule {}
