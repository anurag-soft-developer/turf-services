import { Injectable } from '@nestjs/common';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { TeamService } from '../team/team.service';
import { UsersService } from '../users/users.service';
import { PostService } from '../post/post.service';
import { FollowingsService } from '../followings/followings.service';
import { FollowTargetType } from '../followings/schemas/following.schema';
import { EngagementService } from '../engagement/engagement.service';
import { RedisService } from '../core/redis/redis.service';
import { TeamStatus } from '../team/schemas/team.schema';
import { PostStatus } from '../post/schemas/content-post.schema';
import type { ExploreQueryDto } from './dto/explore.dto';
import type { PublicProfile } from '../users/interfaces/user.interface';
import type {
  ExploreItem,
  ExploreItemType,
  ExploreResponse,
  ScoredExploreItem,
} from './types/explore.types';
import { resolveExploreMatchStatuses } from './util/explore-match-status.util';
import {
  rankExploreItems,
  toScoredExploreItems,
  type RankingContext,
} from './util/explore-ranking.util';
import {
  exploreFiltersHash,
  exploreGeoBucket,
  parseExploreFeedSession,
  type ExploreFeedSession,
} from './util/explore-feed-session.util';
import {
  EXPLORE_FEED_SESSION_TTL_SECONDS,
  USER_LOCATION_THROTTLE_TTL_SECONDS,
  exploreFeedSessionKey,
  userLocThrottleKey,
  type EngagementEntityType,
} from '../engagement/engagement.constants';

const CANDIDATE_LIMIT = 80;
/** Preview size per type on search `category=all` page 1. */
const ALL_SEARCH_PREVIEW_LIMIT = 5;

@Injectable()
export class ExploreService {
  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly teamService: TeamService,
    private readonly usersService: UsersService,
    private readonly postService: PostService,
    private readonly followingsService: FollowingsService,
    private readonly engagementService: EngagementService,
    private readonly redis: RedisService,
  ) {}

  async explore(userId: string, query: ExploreQueryDto): Promise<ExploreResponse> {
    await this.maybeUpsertViewerLocation(userId, query);

    const isSearch = !!query.q?.trim();
    if (isSearch && query.category === 'all') {
      return this.exploreSearchAll(userId, query);
    }

    // Feed (and non-all search) always use a concrete type.
    const type: ExploreItemType =
      query.category === 'all' ? 'match' : query.category;
    return this.exploreRankedCategory(userId, query, type);
  }

  /**
   * Search with category=all:
   * - page 1: limited ranked slices of match → team → player → post
   * - page 2+: posts only (mapped to posts page = query.page - 1)
   */
  private async exploreSearchAll(
    userId: string,
    query: ExploreQueryDto,
  ): Promise<ExploreResponse> {
    if (query.page > 1) {
      const postsPage = query.page - 1;
      const result = await this.exploreRankedFresh(userId, {
        ...query,
        page: postsPage,
        limit: query.limit,
      }, 'post');
      return {
        ...result,
        page: query.page,
        totalPages: 1 + result.totalPages,
      };
    }

    const preview = { page: 1, limit: ALL_SEARCH_PREVIEW_LIMIT };
    const [matchRes, teamRes, playerRes, postRes] = await Promise.all([
      this.fetchByType(userId, query, 'match', preview),
      this.fetchByType(userId, query, 'team', preview),
      this.fetchByType(userId, query, 'player', preview),
      this.fetchByType(userId, query, 'post', preview),
    ]);

    const matchItems = toScoredExploreItems('match', matchRes.data as never);
    const teamItems = toScoredExploreItems('team', teamRes.data as never);
    const playerItems = toScoredExploreItems('player', playerRes.data as never);
    const postItems = toScoredExploreItems('post', postRes.data as never);

    const allItems = [
      ...matchItems,
      ...teamItems,
      ...playerItems,
      ...postItems,
    ];
    const ctx = await this.buildRankingContext(userId, query, allItems);

    const rankedMatches = rankExploreItems(matchItems, ctx).slice(
      0,
      ALL_SEARCH_PREVIEW_LIMIT,
    );
    const rankedTeams = rankExploreItems(teamItems, ctx).slice(
      0,
      ALL_SEARCH_PREVIEW_LIMIT,
    );
    const rankedPlayers = rankExploreItems(playerItems, ctx).slice(
      0,
      ALL_SEARCH_PREVIEW_LIMIT,
    );
    const rankedPosts = rankExploreItems(postItems, ctx).slice(
      0,
      ALL_SEARCH_PREVIEW_LIMIT,
    );

    // Fixed section order: posts last for the All UI.
    const ordered = [
      ...rankedMatches,
      ...rankedTeams,
      ...rankedPlayers,
      ...rankedPosts,
    ];
    const data: ExploreItem[] = ordered.map((item) => this.toExploreItem(item));

    const postsTotalPages =
      Math.ceil(postRes.totalDocuments / query.limit) || 0;
    const totalPages =
      postRes.totalDocuments > ALL_SEARCH_PREVIEW_LIMIT
        ? 1 + postsTotalPages
        : data.length > 0
          ? 1
          : 0;

    return {
      data,
      page: 1,
      limit: query.limit,
      totalDocuments: postRes.totalDocuments,
      totalPages,
    };
  }

  private async exploreRankedCategory(
    userId: string,
    query: ExploreQueryDto,
    type: ExploreItemType,
  ): Promise<ExploreResponse> {
    const isFeed = !query.q?.trim();
    const redisOk = (await this.redis.getClient()) != null;

    if (isFeed && redisOk) {
      return this.exploreFeedWithSession(userId, query, type);
    }

    return this.exploreRankedFresh(userId, query, type);
  }

  private async exploreFeedWithSession(
    userId: string,
    query: ExploreQueryDto,
    type: ExploreItemType,
  ): Promise<ExploreResponse> {
    const sessionKey = exploreFeedSessionKey(
      userId,
      type,
      exploreFiltersHash(query),
      exploreGeoBucket(query),
    );

    let session = parseExploreFeedSession(await this.redis.get(sessionKey));
    if (!session) {
      session = await this.buildAndStoreFeedSession(
        userId,
        query,
        type,
        sessionKey,
      );
    }

    const skip = (query.page - 1) * query.limit;
    const pageIds = session.ids.slice(skip, skip + query.limit);
    return this.toPageResponse(type, pageIds, query, session.totalDocuments);
  }

  private async toPageResponse(
    type: ExploreItemType,
    pageIds: string[],
    query: ExploreQueryDto,
    totalDocuments: number,
  ): Promise<ExploreResponse> {
    const hydrated = await this.hydrateByIds(type, pageIds);
    const items = toScoredExploreItems(type, hydrated as never);
    const data: ExploreItem[] = items.map((item) => this.toExploreItem(item));
    return {
      data,
      page: query.page,
      limit: query.limit,
      totalDocuments,
      totalPages: Math.ceil(totalDocuments / query.limit) || 0,
    };
  }

  private async buildAndStoreFeedSession(
    userId: string,
    query: ExploreQueryDto,
    type: ExploreItemType,
    sessionKey: string,
  ): Promise<ExploreFeedSession> {
    const paging = {
      page: 1,
      limit: Math.max(query.limit, CANDIDATE_LIMIT),
    };
    const result = await this.fetchByType(userId, query, type, paging);
    const items = toScoredExploreItems(type, result.data as never);
    const ctx = await this.buildRankingContext(userId, query, items);
    const ranked = rankExploreItems(items, ctx);
    const ids = ranked
      .map((item) => String((item.data as { _id?: unknown })._id ?? ''))
      .filter(Boolean);

    const session: ExploreFeedSession = {
      ids,
      totalDocuments: result.totalDocuments,
    };
    await this.redis.setEx(
      sessionKey,
      EXPLORE_FEED_SESSION_TTL_SECONDS,
      JSON.stringify(session),
    );
    return session;
  }

  private async exploreRankedFresh(
    userId: string,
    query: ExploreQueryDto,
    type: ExploreItemType,
  ): Promise<ExploreResponse> {
    const result = await this.fetchByType(userId, query, type, {
      page: query.page,
      limit: query.limit,
    });
    const items = toScoredExploreItems(type, result.data as never);
    const ctx = await this.buildRankingContext(userId, query, items);
    const ranked = rankExploreItems(items, ctx);
    const slice = ranked.slice(0, query.limit);

    const data: ExploreItem[] = slice.map((item) => this.toExploreItem(item));
    return {
      data,
      page: query.page,
      limit: query.limit,
      totalDocuments: result.totalDocuments,
      totalPages: Math.ceil(result.totalDocuments / query.limit) || 0,
    };
  }

  private async hydrateByIds(
    type: ExploreItemType,
    ids: string[],
  ): Promise<unknown[]> {
    switch (type) {
      case 'match':
        return this.matchmakingService.findByIdsForExplore(ids);
      case 'team':
        return this.teamService.findByIdsForExplore(ids);
      case 'player':
        return this.usersService.findPublicProfilesByIdsForExplore(ids, {
          includeLastLocation: true,
        });
      case 'post':
        return this.postService.findByIdsForExplore(ids);
      default:
        return [];
    }
  }

  private toExploreItem(item: ScoredExploreItem): ExploreItem {
    switch (item.type) {
      case 'match':
        return { type: 'match', data: item.data };
      case 'team':
        return { type: 'team', data: item.data };
      case 'player':
        return {
          type: 'player',
          data: stripPlayerLocation(item.data as PublicProfile),
        };
      case 'post':
        return { type: 'post', data: item.data };
    }
  }

  private async fetchByType(
    userId: string,
    query: ExploreQueryDto,
    type: ExploreItemType,
    paging: { page: number; limit: number },
  ) {
    const q = { ...query, page: paging.page, limit: paging.limit };
    switch (type) {
      case 'match':
        return this.fetchMatches(userId, q);
      case 'team':
        return this.fetchTeams(userId, q);
      case 'player':
        return this.fetchPlayers(q);
      case 'post':
        return this.fetchPosts(userId, q);
    }
  }

  private async fetchMatches(userId: string, query: ExploreQueryDto) {
    const statuses = resolveExploreMatchStatuses(query.matchStatus);
    const search = query.q?.trim() || undefined;

    return this.matchmakingService.listRequests(userId, {
      scope: query.matchScope,
      statuses,
      search,
      sportType: query.sportType,
      location: query.location,
      sort: 'updatedAt:desc',
      page: query.page,
      limit: query.limit,
      type: 'all',
    });
  }

  private async fetchTeams(userId: string, query: ExploreQueryDto) {
    const search = query.q?.trim() || undefined;

    return this.teamService.findMany(userId, {
      status: TeamStatus.ACTIVE,
      sportType: query.sportType,
      search,
      lookingForMembers: query.lookingForMembers,
      teamOpenForMatch: query.teamOpenForMatch,
      location: query.location,
      page: query.page,
      limit: query.limit,
    });
  }

  private async fetchPlayers(query: ExploreQueryDto) {
    const search = query.q?.trim() || undefined;

    return this.usersService.searchActivePublicProfiles(
      search,
      query.page,
      query.limit,
      {
        location: query.location,
        includeLastLocation: true,
      },
    );
  }

  private async fetchPosts(userId: string, query: ExploreQueryDto) {
    const search = query.q?.trim() || undefined;

    return this.postService.findMany(userId, {
      status: PostStatus.PUBLISHED,
      search,
      sportType: query.sportType,
      location: query.location,
      page: query.page,
      limit: query.limit,
    });
  }

  private async buildRankingContext(
    userId: string,
    query: ExploreQueryDto,
    items: ScoredExploreItem[],
  ): Promise<RankingContext> {
    const [followedUsers, followedTeams, viewer] = await Promise.all([
      this.followingsService.distinctAcceptedRecipientIds(
        userId,
        FollowTargetType.USER,
      ),
      this.followingsService.distinctAcceptedRecipientIds(
        userId,
        FollowTargetType.TEAM,
      ),
      this.usersService.findById(userId, 'playerSportStats'),
    ]);

    const refs = items.map((item) => ({
      entityType: item.type as EngagementEntityType,
      entityId: String((item.data as { _id?: unknown })._id ?? ''),
    }));
    const stats = await this.engagementService.getStatsMap(refs);

    const viewerSports = new Set(
      (viewer?.playerSportStats ?? []).map((s) => String(s.sportType)),
    );

    const origin =
      query.location?.nearbyLat !== undefined &&
      query.location?.nearbyLng !== undefined
        ? { lat: query.location.nearbyLat, lng: query.location.nearbyLng }
        : undefined;

    return {
      userId,
      mode: query.q?.trim() ? 'search' : 'feed',
      query: query.q,
      origin,
      followedUserIds: new Set(followedUsers),
      followedTeamIds: new Set(followedTeams),
      viewerSports,
      querySport: query.sportType,
      stats,
    };
  }

  private async maybeUpsertViewerLocation(
    userId: string,
    query: ExploreQueryDto,
  ): Promise<void> {
    const lat = query.location?.nearbyLat;
    const lng = query.location?.nearbyLng;
    if (lat === undefined || lng === undefined) return;

    const client = await this.redis.getClient();
    if (client) {
      const acquired = await this.redis.setNxEx(
        userLocThrottleKey(userId),
        USER_LOCATION_THROTTLE_TTL_SECONDS,
      );
      if (!acquired) return;
    }
    await this.usersService.upsertLastLocation(userId, lat, lng);
  }
}

function stripPlayerLocation(player: PublicProfile): PublicProfile {
  const { lastLocation: _ignored, ...rest } = player;
  return rest;
}
