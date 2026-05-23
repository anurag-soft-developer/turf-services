import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { HostOnboardingService } from './host-onboarding.service';
import { RajorpayService } from '../core/services/rajorpay/rajorpay.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService, HostOnboardingService, RajorpayService],
  exports: [UsersService, HostOnboardingService],
})
export class UsersModule {}