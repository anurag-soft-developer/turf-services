import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Event } from '../events/schemas/event.schema';
import { Media } from '../post/schemas/media.schema';
import { TeamMatch } from '../matchmaking/schemas/team-match.schema';
import { Team } from '../team/schemas/team.schema';
import { TurfReview } from '../turf-review/schemas/turf-review.schema';
import { Turf } from '../turf/schemas/turf.schema';
import { User } from '../users/schemas/user.schema';
import { Withdrawal } from '../withdrawals/schemas/withdrawal.schema';
import { inferObjectKeyFromPublicUrl } from './storage-url.util';

@Injectable()
export class StorageReferenceCollectorService {
  constructor(
    @InjectModel(Turf.name) private readonly turfModel: Model<Turf>,
    @InjectModel(Event.name) private readonly eventModel: Model<Event>,
    @InjectModel(Team.name) private readonly teamModel: Model<Team>,
    @InjectModel(TurfReview.name)
    private readonly turfReviewModel: Model<TurfReview>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Media.name) private readonly mediaModel: Model<Media>,
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<Withdrawal>,
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatch>,
  ) {}

  async collectAllReferencedObjectKeys(): Promise<Set<string>> {
    const keys = new Set<string>();

    const addUrl = (url: string | undefined | null) => {
      if (!url) return;
      const key = inferObjectKeyFromPublicUrl(url);
      if (key) keys.add(key);
    };

    const addUrls = (urls: string[] | undefined | null) => {
      for (const url of urls ?? []) {
        addUrl(url);
      }
    };

    const [
      turfs,
      events,
      teams,
      reviews,
      users,
      mediaDocs,
      withdrawals,
      matches,
    ] = await Promise.all([
      this.turfModel.find().select('images').lean(),
      this.eventModel.find().select('coverImages').lean(),
      this.teamModel.find().select('logo coverImages').lean(),
      this.turfReviewModel.find().select('images').lean(),
      this.userModel.find().select('avatar').lean(),
      this.mediaModel.find().select('url').lean(),
      this.withdrawalModel.find().select('attachments').lean(),
      this.teamMatchModel.find().select('announcedPlayers').lean(),
    ]);

    for (const turf of turfs) {
      addUrls(turf.images);
    }
    for (const event of events) {
      addUrls(event.coverImages);
    }
    for (const team of teams) {
      addUrl(team.logo);
      addUrls(team.coverImages);
    }
    for (const review of reviews) {
      addUrls(review.images);
    }
    for (const user of users) {
      addUrl(user.avatar);
    }
    for (const media of mediaDocs) {
      addUrl(media.url);
    }
    for (const withdrawal of withdrawals) {
      addUrls(withdrawal.attachments);
    }
    for (const match of matches) {
      for (const player of match.announcedPlayers ?? []) {
        addUrl(player.avatar);
      }
    }

    return keys;
  }
}
