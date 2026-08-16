import type { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';
import type { PublicProfile } from '../../users/interfaces/user.interface';
import type { ContentPostDocument } from '../../post/schemas/content-post.schema';
import type { PaginatedResult } from '../../core/interfaces/common';

export type ExploreItemType = 'match' | 'team' | 'player' | 'post';

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

export type ExploreItem =
  | ExploreMatchItem
  | ExploreTeamItem
  | ExplorePlayerItem
  | ExplorePostItem;

export type ExploreResponse = PaginatedResult<ExploreItem>;

export type ScoredExploreItem = ExploreItem & { score: number };
