import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Following, FollowingSchema } from './schemas/following.schema';
import { FollowingsService } from './followings.service';
import { FollowingsController } from './followings.controller';
import { NotificationModule } from '../notification/notification.module';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Following.name, schema: FollowingSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationModule,
  ],
  controllers: [FollowingsController],
  providers: [FollowingsService],
  exports: [FollowingsService],
})
export class FollowingsModule {}
