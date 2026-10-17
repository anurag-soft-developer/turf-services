import { Injectable } from '@nestjs/common';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { TeamService } from '../team/team.service';
import { UsersService } from '../users/users.service';
import { PostService } from '../post/post.service';
import { OpeningsService } from '../openings/openings.service';
import { OpeningStatus } from '../openings/schemas/opening.schema';
import type { OpeningView } from '../openings/util/opening-view.util';
import { FollowingsService } from '../followings/followings.service';
import { FollowTargetType } from '../followings/schemas/following.schema';
import { EngagementService } from '../engagement/engagement.service';
import { RedisService } from '../core/redis/redis.service';
import { TeamStatus } from '../team/schemas/team.schema';
import { PostStatus } from '../post/schemas/content-post.schema';
import type { ExploreQueryDto } from './dto/explore.dto';
import type { PublicProfile } from '../users/interfaces/user.interface';
import type { PaginatedResult } from '../core/interfaces/common';
import type {
  ExploreFeedItemType,
  ExploreItem,
  ExploreItemType,
  ExploreResponse,
  ScoredExploreItem,
} from './types/explore.types';
import {
  exploreFiltersHash,
  exploreGeoBucket,
  parseExploreFeedSession,
  resolveExploreMatchStatuses,
  toPlainExploreData,
  weaveOpenings,
  type ExploreFeedRef,
  type ExploreFeedSession,
} from './util/explore-feed.util';
import {
  rankExploreItems,
  toScoredExploreItems,
  type RankingContext,
} from './util/explore-ranking.util';
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
    private readonly openingsService: OpeningsService,
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
    const data = await this.attachEngagement(
      userId,
      ordered.map((item) => this.toExploreItem(item)),
    );

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

    if (query.category === 'post') {
      if (isFeed && redisOk) {
        return this.exploreFeedWithSession(userId, query, type);
      }
      return this.explorePostsPage(userId, query);
    }

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
      session =
        query.category === 'post'
          ? await this.buildPostsFeedSession(userId, query, sessionKey)
          : await this.buildAndStoreFeedSession(
              userId,
              query,
              type,
              sessionKey,
            );
    }

    const skip = (query.page - 1) * query.limit;
    if (
      query.category === 'post' &&
      skip >= session.refs.length &&
      session.refs.length < session.totalDocuments
    ) {
      session = await this.extendPostsFeedSession(
        userId,
        query,
        sessionKey,
        session,
        skip + query.limit,
      );
    }

    const pageRefs = session.refs.slice(skip, skip + query.limit);
    return this.toPageResponse(
      userId,
      pageRefs,
      query,
      session.totalDocuments,
    );
  }

  private async toPageResponse(
    userId: string,
    pageRefs: ExploreFeedRef[],
    query: ExploreQueryDto,
    totalDocuments: number,
  ): Promise<ExploreResponse> {
    const items = await this.hydrateRefs(userId, pageRefs);
    const data = await this.attachEngagement(
      userId,
      items.map((item) => this.toExploreItem(item)),
    );
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
    const refs = feedRefsFromRanked(ranked, type);

    const session: ExploreFeedSession = {
      refs,
      totalDocuments: result.totalDocuments,
    };
    await this.redis.setEx(
      sessionKey,
      EXPLORE_FEED_SESSION_TTL_SECONDS,
      JSON.stringify(session),
    );
    return session;
  }

  /**
   * One page from each posts source, ranked separately and woven.
   * Search uses this. The feed uses it only when Redis is unavailable.
   */
  private async explorePostsPage(
    userId: string,
    query: ExploreQueryDto,
  ): Promise<ExploreResponse> {
    const sources = postSources(query.postKind);
    const paging = { page: query.page, limit: query.limit };
    const [postRes, openingRes] = await Promise.all([
      sources.posts
        ? this.fetchPosts(userId, { ...query, ...paging })
        : Promise.resolve(emptyExplorePage<never>()),
      sources.openings
        ? this.fetchOpenings(userId, { ...query, ...paging })
        : Promise.resolve(emptyExplorePage<OpeningView>()),
    ]);
    const ranked = await this.rankPostSources(
      userId,
      query,
      postRes.data,
      openingRes.data,
    );
    const woven = weaveOpenings(ranked.posts, ranked.openings, {
      keepRemainder: true,
    });
    const data = await this.attachEngagement(
      userId,
      woven.map((item) => this.toExploreItem(item)),
    );
    const totalDocuments =
      postRes.totalDocuments + openingRes.totalDocuments;
    return {
      data,
      page: query.page,
      limit: query.limit,
      totalDocuments,
      totalPages: Math.max(postRes.totalPages, openingRes.totalPages),
    };
  }

  private async buildPostsFeedSession(
    userId: string,
    query: ExploreQueryDto,
    sessionKey: string,
  ): Promise<ExploreFeedSession> {
    const window = await this.loadRankedPostWindow(userId, query, []);
    const session: ExploreFeedSession = {
      refs: window.refs,
      totalDocuments: window.totalDocuments,
    };
    await this.storeFeedSession(sessionKey, session);
    return session;
  }

  private async extendPostsFeedSession(
    userId: string,
    query: ExploreQueryDto,
    sessionKey: string,
    session: ExploreFeedSession,
    needed: number,
  ): Promise<ExploreFeedSession> {
    let next = session;
    let guard = 0;
    while (
      next.refs.length < needed &&
      next.refs.length < next.totalDocuments &&
      guard < 15
    ) {
      guard += 1;
      const window = await this.loadRankedPostWindow(userId, query, next.refs);
      const seen = new Set(next.refs.map((ref) => feedRefKey(ref)));
      const appended = window.refs.filter((ref) => !seen.has(feedRefKey(ref)));
      if (!appended.length) break;
      next = {
        refs: [...next.refs, ...appended],
        totalDocuments: next.totalDocuments,
      };
      await this.storeFeedSession(sessionKey, next);
    }
    return next;
  }

  private async loadRankedPostWindow(
    userId: string,
    query: ExploreQueryDto,
    stored: ExploreFeedRef[],
  ): Promise<{ refs: ExploreFeedRef[]; totalDocuments: number }> {
    const sources = postSources(query.postKind);
    const paging = {
      page: 1,
      limit: Math.max(query.limit, CANDIDATE_LIMIT),
    };
    const q = { ...query, page: paging.page, limit: paging.limit };
    const [postRes, openingRes] = await Promise.all([
      sources.posts
        ? this.fetchPosts(
            userId,
            q,
            stored.filter((ref) => ref.type === 'post').map((ref) => ref.id),
          )
        : Promise.resolve(emptyExplorePage<never>()),
      sources.openings
        ? this.fetchOpenings(
            userId,
            q,
            stored
              .filter((ref) => ref.type === 'opening')
              .map((ref) => ref.id),
          )
        : Promise.resolve(emptyExplorePage<OpeningView>()),
    ]);
    const ranked = await this.rankPostSources(
      userId,
      query,
      postRes.data,
      openingRes.data,
    );
    return {
      refs: weaveOpenings(
        feedRefsFromRanked(ranked.posts),
        feedRefsFromRanked(ranked.openings),
      ),
      totalDocuments: postRes.totalDocuments + openingRes.totalDocuments,
    };
  }

  /** Rank media posts and openings separately so post order stays intact. */
  private async rankPostSources(
    userId: string,
    query: ExploreQueryDto,
    postData: readonly unknown[],
    openingData: readonly OpeningView[],
  ): Promise<{ posts: ScoredExploreItem[]; openings: ScoredExploreItem[] }> {
    const posts = toScoredExploreItems('post', postData);
    const openings = toScoredExploreItems('opening', openingData);
    const ctx = await this.buildRankingContext(userId, query, [
      ...posts,
      ...openings,
    ]);
    return {
      posts: rankExploreItems(posts, ctx),
      openings: rankExploreItems(openings, ctx),
    };
  }

  private async storeFeedSession(
    sessionKey: string,
    session: ExploreFeedSession,
  ): Promise<void> {
    await this.redis.setEx(
      sessionKey,
      EXPLORE_FEED_SESSION_TTL_SECONDS,
      JSON.stringify(session),
    );
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

    const data = await this.attachEngagement(
      userId,
      slice.map((item) => this.toExploreItem(item)),
    );
    return {
      data,
      page: query.page,
      limit: query.limit,
      totalDocuments: result.totalDocuments,
      totalPages: Math.ceil(result.totalDocuments / query.limit) || 0,
    };
  }

  private async hydrateRefs(
    userId: string,
    refs: ExploreFeedRef[],
  ): Promise<ScoredExploreItem[]> {
    const idsByType = new Map<ExploreFeedItemType, string[]>();
    for (const ref of refs) {
      const list = idsByType.get(ref.type) ?? [];
      list.push(ref.id);
      idsByType.set(ref.type, list);
    }

    const loaded = new Map<string, unknown>();
    await Promise.all(
      [...idsByType.entries()].map(async ([type, ids]) => {
        const rows = await this.hydrateByType(userId, type, ids);
        for (const row of rows) {
          const id = String((row as { _id?: unknown })._id ?? '');
          if (id) loaded.set(feedRefKey({ type, id }), row);
        }
      }),
    );

    return refs.flatMap((ref) => {
      const data = loaded.get(feedRefKey(ref));
      if (data == null) return [];
      return [{ type: ref.type, data, score: 0 } as ScoredExploreItem];
    });
  }

  private async hydrateByType(
    userId: string,
    type: ExploreFeedItemType,
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
      case 'opening':
        return this.openingsService.findByIds(ids, userId);
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
      case 'opening':
        return { type: 'opening', data: item.data };
    }
  }

  /** Attach likeCount + likedByMe onto each item's `data` for the client. */
  private async attachEngagement(
    userId: string,
    items: ExploreItem[],
  ): Promise<ExploreItem[]> {
    if (!items.length) return items;

    const refs = items
      .filter((item) => item.type !== 'opening')
      .map((item) => ({
        entityType: item.type as EngagementEntityType,
        entityId: String((item.data as { _id?: unknown })._id ?? ''),
      }))
      .filter((ref) => ref.entityId);

    if (!refs.length) return items;

    const [stats, liked] = await Promise.all([
      this.engagementService.getStatsMap(refs),
      this.engagementService.getLikedSet(userId, refs),
    ]);

    return items.map((item) => {
      if (item.type === 'opening') return item;
      const entityId = String((item.data as { _id?: unknown })._id ?? '');
      const key = `${item.type}:${entityId}`;
      const likeCount = stats.get(key)?.likeCount ?? 0;
      const likedByMe = liked.has(key);
      return {
        ...item,
        data: {
          ...toPlainExploreData(item.data),
          likeCount,
          likedByMe,
        },
      } as unknown as ExploreItem;
    });
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

  private async fetchPosts(
    userId: string,
    query: ExploreQueryDto,
    excludeIds?: string[],
  ) {
    const search = query.q?.trim() || undefined;

    return this.postService.findMany(
      userId,
      {
        status: PostStatus.PUBLISHED,
        search,
        sportType: query.sportType,
        location: query.location,
        page: query.page,
        limit: query.limit,
      },
      excludeIds?.length ? { excludeIds } : undefined,
    );
  }

  private async fetchOpenings(
    userId: string,
    query: ExploreQueryDto,
    excludeIds?: string[],
  ) {
    const search = query.q?.trim() || undefined;
    return this.openingsService.findMany(
      {
        status: OpeningStatus.OPEN,
        sportType: query.sportType,
        page: query.page,
        limit: query.limit,
      },
      userId,
      {
        excludeIds,
        search,
      },
    );
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

    const refs = items
      .filter((item) => item.type !== 'opening')
      .map((item) => ({
        entityType: item.type as EngagementEntityType,
        entityId: String((item.data as { _id?: unknown })._id ?? ''),
      }))
      .filter((ref) => ref.entityId);
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

function postSources(postKind: ExploreQueryDto['postKind']): {
  posts: boolean;
  openings: boolean;
} {
  switch (postKind) {
    case 'media':
      return { posts: true, openings: false };
    case 'opening':
      return { posts: false, openings: true };
    case 'all':
    default:
      return { posts: true, openings: true };
  }
}

function emptyExplorePage<T>(): PaginatedResult<T> {
  return {
    data: [],
    totalDocuments: 0,
    page: 1,
    limit: 0,
    totalPages: 0,
  };
}

function feedRefKey(ref: ExploreFeedRef): string {
  return `${ref.type}:${ref.id}`;
}

function feedRefsFromRanked(
  ranked: ScoredExploreItem[],
  type?: ExploreItemType,
): ExploreFeedRef[] {
  const refs: ExploreFeedRef[] = [];
  for (const item of ranked) {
    const id = String((item.data as { _id?: unknown })._id ?? '');
    if (!id) continue;
    if (item.type === 'opening' || item.type === 'post') {
      refs.push({ type: item.type, id });
      continue;
    }
    if (type) refs.push({ type, id });
  }
  return refs;
}
