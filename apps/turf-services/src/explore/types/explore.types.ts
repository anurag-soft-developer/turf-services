import type { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';
import type { PublicProfile } from '../../users/interfaces/user.interface';
import type { PaginatedResult } from '../../core/interfaces/common';

export type ExploreItemType =
  | 'match'
  | 'team'
  | 'player'
  | 'team_row'
  | 'player_row';

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

export type ExploreTeamRowItem = {
  type: 'team_row';
  data: {
    title: string;
    reason: string;
    items: TeamDocument[];
  };
};

export type ExplorePlayerRowItem = {
  type: 'player_row';
  data: {
    title: string;
    reason: string;
    items: PublicProfile[];
  };
};

export type ExploreFlatItem =
  | ExploreMatchItem
  | ExploreTeamItem
  | ExplorePlayerItem;

export type ExploreItem =
  | ExploreFlatItem
  | ExploreTeamRowItem
  | ExplorePlayerRowItem;

export type ExploreResponse = PaginatedResult<ExploreItem> & {
  meta?: {
    counts?: {
      match: number;
      team: number;
      player: number;
    };
  };
};

export type ScoredExploreItem = ExploreFlatItem & { score: number };
