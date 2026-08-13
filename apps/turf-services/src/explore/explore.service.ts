import { Injectable } from '@nestjs/common';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { TeamService } from '../team/team.service';
import { UsersService } from '../users/users.service';
import { TeamStatus } from '../team/schemas/team.schema';
import type { ExploreQueryDto } from './dto/explore.dto';
import type { PaginatedResult } from '../core/interfaces/common';
import type {
  ExploreItem,
  ExploreResponse,
  ScoredExploreItem,
} from './types/explore.types';
import { resolveExploreMatchStatuses } from './util/explore-match-status.util';
import {
  rankExploreItems,
  toScoredExploreItems,
} from './util/explore-ranking.util';

const TEAM_ROW_EVERY = 3;
const PLAYER_ROW_EVERY = 5;
const TEAM_ROW_SIZE = 6;
const PLAYER_ROW_SIZE = 8;
const FEED_POOL_LIMIT = 12;

@Injectable()
export class ExploreService {
  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly teamService: TeamService,
    private readonly usersService: UsersService,
  ) {}

  async explore(userId: string, query: ExploreQueryDto): Promise<ExploreResponse> {
    const { category } = query;

    if (category === 'match') {
      return this.exploreMatches(userId, query);
    }
    if (category === 'team') {
      return this.exploreTeams(userId, query);
    }
    if (category === 'player') {
      return this.explorePlayers(userId, query);
    }

    // category=all: feed (rows) when no search query; flat merge when searching
    if (!query.q?.trim()) {
      return this.exploreFeed(userId, query);
    }

    return this.exploreAll(userId, query);
  }

  private async exploreMatches(
    userId: string,
    query: ExploreQueryDto,
  ): Promise<ExploreResponse> {
    const result = await this.fetchMatches(userId, query);
    return this.wrapSingleCategory(result, 'match');
  }

  private async exploreTeams(
    userId: string,
    query: ExploreQueryDto,
  ): Promise<ExploreResponse> {
    const result = await this.fetchTeams(userId, query);
    return this.wrapSingleCategory(result, 'team');
  }

  private async explorePlayers(
    userId: string,
    query: ExploreQueryDto,
  ): Promise<ExploreResponse> {
    const result = await this.fetchPlayers(query);
    return this.wrapSingleCategory(result, 'player');
  }

  private wrapSingleCategory<T>(
    result: PaginatedResult<T>,
    type: 'match' | 'team' | 'player',
  ): ExploreResponse {
    const data: ExploreItem[] = result.data.map((item) => ({
      type,
      data: item as never,
    }));

    return {
      data,
      page: result.page,
      limit: result.limit,
      totalDocuments: result.totalDocuments,
      totalPages: result.totalPages,
    };
  }

  /**
   * Explore feed: vertical matches with occasional horizontal team/player rows.
   * Pagination is driven by match totals; row inserts may make page length >
   * `limit`.
   */
  private async exploreFeed(
    userId: string,
    query: ExploreQueryDto,
  ): Promise<ExploreResponse> {
    const { page, limit } = query;
    const poolQuery = { ...query, page: 1, limit: FEED_POOL_LIMIT };

    const [matches, teams, players] = await Promise.all([
      this.fetchMatches(userId, query),
      this.fetchTeams(userId, poolQuery),
      this.fetchPlayers(poolQuery),
    ]);

    const matchesBefore = (page - 1) * limit;
    let teamCursor = Math.floor(matchesBefore / TEAM_ROW_EVERY) * TEAM_ROW_SIZE;
    let playerCursor =
      Math.floor(matchesBefore / PLAYER_ROW_EVERY) * PLAYER_ROW_SIZE;

    const teamPool = teams.data;
    const playerPool = players.data;
    const data: ExploreItem[] = [];

    matches.data.forEach((match, index) => {
      data.push({ type: 'match', data: match });

      const globalMatchIndex = matchesBefore + index + 1;

      if (globalMatchIndex % TEAM_ROW_EVERY === 0) {
        const items = this.takeSlice(teamPool, teamCursor, TEAM_ROW_SIZE);
        teamCursor += TEAM_ROW_SIZE;
        if (items.length > 0) {
          data.push({
            type: 'team_row',
            data: {
              title: 'Teams to explore',
              reason: 'open_for_match',
              items,
            },
          });
        }
      }

      if (globalMatchIndex % PLAYER_ROW_EVERY === 0) {
        const items = this.takeSlice(playerPool, playerCursor, PLAYER_ROW_SIZE);
        playerCursor += PLAYER_ROW_SIZE;
        if (items.length > 0) {
          data.push({
            type: 'player_row',
            data: {
              title: 'Players to follow',
              reason: 'rising',
              items,
            },
          });
        }
      }
    });

    return {
      data,
      page: matches.page,
      limit: matches.limit,
      totalDocuments: matches.totalDocuments,
      totalPages: matches.totalPages,
      meta: {
        counts: {
          match: matches.totalDocuments,
          team: teams.totalDocuments,
          player: players.totalDocuments,
        },
      },
    };
  }

  private takeSlice<T>(pool: T[], cursor: number, size: number): T[] {
    if (cursor >= pool.length) {
      return [];
    }
    return pool.slice(cursor, cursor + size);
  }

  private async exploreAll(
    userId: string,
    query: ExploreQueryDto,
  ): Promise<ExploreResponse> {
    const { page, limit } = query;
    const fetchLimit = page * limit;
    const fetchQuery = { ...query, page: 1, limit: fetchLimit };

    const [matches, teams, players] = await Promise.all([
      this.fetchMatches(userId, fetchQuery),
      this.fetchTeams(userId, fetchQuery),
      this.fetchPlayers(fetchQuery),
    ]);

    const items = [
      ...toScoredExploreItems('match', matches.data),
      ...toScoredExploreItems('team', teams.data),
      ...toScoredExploreItems('player', players.data),
    ];

    const ranked = rankExploreItems({
      items,
      mode: 'search',
      query: query.q,
      userId,
    });

    const start = (page - 1) * limit;
    const slice = ranked.slice(start, start + limit);
    const data = slice.map((item) => this.toExploreItem(item));

    const totalDocuments =
      matches.totalDocuments + teams.totalDocuments + players.totalDocuments;

    return {
      data,
      page,
      limit,
      totalDocuments,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
      meta: {
        counts: {
          match: matches.totalDocuments,
          team: teams.totalDocuments,
          player: players.totalDocuments,
        },
      },
    };
  }

  private toExploreItem(item: ScoredExploreItem): ExploreItem {
    switch (item.type) {
      case 'match':
        return { type: 'match', data: item.data };
      case 'team':
        return { type: 'team', data: item.data };
      case 'player':
        return { type: 'player', data: item.data };
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
    );
  }
}
