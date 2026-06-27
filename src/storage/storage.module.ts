import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { Media, MediaSchema } from '../post/schemas/media.schema';
import {
  TeamMatch,
  TeamMatchSchema,
} from '../matchmaking/schemas/team-match.schema';
import { Team, TeamSchema } from '../team/schemas/team.schema';
import {
  TurfReview,
  TurfReviewSchema,
} from '../turf-review/schemas/turf-review.schema';
import { Turf, TurfSchema } from '../turf/schemas/turf.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Withdrawal,
  WithdrawalSchema,
} from '../withdrawals/schemas/withdrawal.schema';
import {
  UnusedUploadRegistry,
  UnusedUploadRegistrySchema,
} from './schemas/unused-upload-registry.schema';
import { StorageReferenceCollectorService } from './storage-reference-collector.service';
import { StorageLifecycleService } from './storage-lifecycle.service';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { UnusedUploadRegistryCleanupService } from './unused-upload-registry-cleanup.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UnusedUploadRegistry.name, schema: UnusedUploadRegistrySchema },
      { name: Turf.name, schema: TurfSchema },
      { name: Event.name, schema: EventSchema },
      { name: Team.name, schema: TeamSchema },
      { name: TurfReview.name, schema: TurfReviewSchema },
      { name: User.name, schema: UserSchema },
      { name: Media.name, schema: MediaSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: TeamMatch.name, schema: TeamMatchSchema },
    ]),
  ],
  controllers: [StorageController],
  providers: [
    StorageService,
    StorageLifecycleService,
    StorageReferenceCollectorService,
    UnusedUploadRegistryCleanupService,
  ],
  exports: [StorageService, StorageLifecycleService],
})
export class StorageModule {}
