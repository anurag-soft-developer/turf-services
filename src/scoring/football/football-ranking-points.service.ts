import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { MatchRankingPointsSnapshot } from '../../core/points/ranking-points.types';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import { SportType, Team, TeamDocument } from '../../team/schemas/team.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { FootballMatchEvent } from './football-match-event.schema';
import {
  computeFootballMatchRankingPoints,
  toMatchRankingSnapshot,
} from './football-points.calculator';

@Injectable()
export class FootballRankingPointsService {
  constructor(
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Applies match ranking points to teams and players. Idempotent per match.
   * Returns snapshot stored on the match for audit.
   */
  async applyMatchRankingPoints(
    match: TeamMatchDocument,
    events: FootballMatchEvent[],
    winnerTeamId: string | null,
    isDraw: boolean,
  ): Promise<MatchRankingPointsSnapshot | null> {
    if (match.rankingPointsAppliedAt) {
      return (
        (match.rankingPointsSnapshot as MatchRankingPointsSnapshot) ?? null
      );
    }

    const result = computeFootballMatchRankingPoints(
      match,
      events,
      winnerTeamId,
      isDraw,
      { includeResultBonuses: true },
    );
    const snapshot = toMatchRankingSnapshot(result);

    await Promise.all([
      ...snapshot.teams.map((t) => this.applyTeamDelta(t.teamId, t.points)),
      ...snapshot.players.map((p) =>
        this.applyPlayerDelta(p.userId, SportType.FOOTBALL, p.points),
      ),
    ]);

    match.rankingPointsAppliedAt = new Date();
    match.rankingPointsSnapshot = snapshot as unknown as Record<
      string,
      unknown
    >;
    match.markModified('rankingPointsSnapshot');

    return snapshot;
  }

  private async applyTeamDelta(teamId: string, delta: number): Promise<void> {
    if (delta === 0) {
      return;
    }
    const team = await this.teamModel.findById(teamId);
    if (!team) {
      return;
    }
    team.rankingPoints = Math.max(0, (team.rankingPoints ?? 0) + delta);
    await team.save();
  }

  private async applyPlayerDelta(
    userId: string,
    sportType: SportType,
    delta: number,
  ): Promise<void> {
    if (delta === 0) {
      return;
    }
    const user = await this.userModel.findById(userId);
    if (!user) {
      return;
    }
    if (!user.sportRankingPoints) {
      user.sportRankingPoints = [];
    }
    let entry = user.sportRankingPoints.find((e) => e.sportType === sportType);
    if (!entry) {
      entry = { sportType, points: 0 };
      user.sportRankingPoints.push(entry);
    }
    entry.points = Math.max(0, entry.points + delta);
    user.markModified('sportRankingPoints');
    await user.save();
  }
}
