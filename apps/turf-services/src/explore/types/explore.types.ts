import type { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';
import type { PublicProfile } from '../../users/interfaces/user.interface';
import type { ContentPostDocument } from '../../post/schemas/content-post.schema';
import type { OpeningView } from '../../openings/util/opening-view.util';
import type { PaginatedResult } from '../../core/interfaces/common';

export type ExploreItemType = 'match' | 'team' | 'player' | 'post';

/** Feed rows. Openings share the posts category but are not an engagement type. */
export type ExploreFeedItemType = ExploreItemType | 'opening';

export type ExploreMatchItem = {
  type: 'match';
  data: TeamMatchDocument;
};

export type ExploreTeamItem = {
  type: 'team';
  data: TeamDocument;
};

export type ExplorePlayerItem = {
  type: 'player';
  data: PublicProfile;
};

export type ExplorePostItem = {
  type: 'post';
  data: ContentPostDocument;
};

export type ExploreOpeningItem = {
  type: 'opening';
  data: OpeningView;
};

export type ExploreItem =
  | ExploreMatchItem
  | ExploreTeamItem
  | ExplorePlayerItem
  | ExplorePostItem
  | ExploreOpeningItem;

export type ExploreResponse = PaginatedResult<ExploreItem>;

export type ScoredExploreItem = ExploreItem & { score: number };
