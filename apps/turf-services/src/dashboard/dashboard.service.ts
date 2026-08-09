import { Injectable } from '@nestjs/common';
import { TurfService } from '../turf/turf.service';
import { TeamService } from '../team/team.service';
import { TeamStatus } from '../team/schemas/team.schema';
import { ITurf } from '../turf/interfaces/turf.interface';
import { NotificationService } from '../notification/notification.service';
import { PlayerDashboardQueryDto } from './dto/player-dashboard.dto';

const DASHBOARD_TURF_LIMIT = 5;
const DEFAULT_NEARBY_RADIUS_KM = 10;

export type PlayerDashboardResponse = {
  turfsTitle: 'Nearby turves' | 'Featured turves';
  turfs: ITurf[];
  nearbyTeamsCount: number;
  unreadNotificationCount: number;
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly turfService: TurfService,
    private readonly teamService: TeamService,
    private readonly notificationService: NotificationService,
  ) {}

  async getPlayerDashboard(
    userId: string,
    query: PlayerDashboardQueryDto,
  ): Promise<PlayerDashboardResponse> {
    const location = query.location;
    const hasLocation =
      location?.nearbyLat !== undefined && location?.nearbyLng !== undefined;
    const nearbyRadiusKm =
      location?.nearbyRadiusKm ?? DEFAULT_NEARBY_RADIUS_KM;

    const [nearbyTeamsCount, unreadNotificationCount] = await Promise.all([
      hasLocation
        ? this.countNearbyOpenForMatchTeams(userId, {
            nearbyLat: location.nearbyLat,
            nearbyLng: location.nearbyLng,
            nearbyRadiusKm,
          })
        : Promise.resolve(0),
      this.notificationService.countUnreadForUser(userId),
    ]);

    if (hasLocation) {
      const nearbyTurfs = await this.fetchTurfsWithImages({
        nearbyLat: location.nearbyLat,
        nearbyLng: location.nearbyLng,
        nearbyRadiusKm,
        sort: 'distance:asc',
      });

      if (nearbyTurfs.length > 0) {
        return {
          turfsTitle: 'Nearby turves',
          turfs: nearbyTurfs,
          nearbyTeamsCount,
          unreadNotificationCount,
        };
      }
    }

    const featuredTurfs = await this.fetchTurfsWithImages({
      sort: 'averageRating:desc',
    });

    return {
      turfsTitle: 'Featured turves',
      turfs: featuredTurfs,
      nearbyTeamsCount,
      unreadNotificationCount,
    };
  }

  private async fetchTurfsWithImages(options: {
    nearbyLat?: number;
    nearbyLng?: number;
    nearbyRadiusKm?: number;
    sort: string;
  }): Promise<ITurf[]> {
    const { nearbyLat, nearbyLng, nearbyRadiusKm, sort } = options;
    const hasGeo = nearbyLat !== undefined && nearbyLng !== undefined;

    const result = await this.turfService.searchFeedTurfs({
      ...(hasGeo
        ? {
            location: {
              nearbyLat,
              nearbyLng,
              nearbyRadiusKm: nearbyRadiusKm ?? DEFAULT_NEARBY_RADIUS_KM,
            },
          }
        : {}),
      hasImages: true,
      page: 1,
      limit: DASHBOARD_TURF_LIMIT,
      sort,
    });

    return result.data;
  }

  private async countNearbyOpenForMatchTeams(
    userId: string,
    location: {
      nearbyLat: number;
      nearbyLng: number;
      nearbyRadiusKm: number;
    },
  ): Promise<number> {
    const result = await this.teamService.findMany(userId, {
      teamOpenForMatch: true,
      status: TeamStatus.ACTIVE,
      location,
      page: 1,
      limit: 1,
    });

    return result.totalDocuments;
  }
}
