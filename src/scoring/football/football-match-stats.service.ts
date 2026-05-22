import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { FootballPlayerStats } from '../../core/sports/sport-stats';
import { TeamMatchDocument } from '../../matchmaking/schemas/team-match.schema';
import {
  SportType,
  Team,
  TeamDocument,
} from '../../team/schemas/team.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { FootballMatchEvent } from './football-match-event.schema';
import {
  aggregateFootballMatchStats,
  FootballMatchStatsSnapshot,
} from './util/football-match-stats.aggregator';
import {
  emptyFootballPlayerStats,
  emptyTeamFootballStats,
} from './util/football-stats.defaults';

@Injectable()
export class FootballMatchStatsService {
  constructor(
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async applyMatchStats(
    match: TeamMatchDocument,
    events: FootballMatchEvent[],
    winnerTeamId: string | null,
    isDraw: boolean,
  ): Promise<void> {
    const snapshot = aggregateFootballMatchStats(
      match,
      events,
      winnerTeamId,
      isDraw,
    );
    await Promise.all([
      ...snapshot.teams.map((t) =>
        this.applyTeamContribution(t.teamId, t.sportStats, t.won, isDraw),
      ),
      ...snapshot.players.map((p) => this.applyPlayerContribution(p)),
    ]);
  }

  private async applyTeamContribution(
    teamId: string,
    delta: FootballMatchStatsSnapshot['teams'][0]['sportStats'],
    won: boolean,
    isDraw: boolean,
  ): Promise<void> {
    const team = await this.teamModel.findById(teamId);
    if (!team) {
      return;
    }

    team.matchesPlayed += 1;
    if (isDraw) {
      team.draws += 1;
    } else if (won) {
      team.wins += 1;
    } else {
      team.losses += 1;
    }
    team.winRate =
      team.matchesPlayed > 0 ? team.wins / team.matchesPlayed : 0;

    const key = SportType.FOOTBALL;
    const prev = team.sportStats?.[key] ?? emptyTeamFootballStats();
    team.sportStats = {
      ...team.sportStats,
      [key]: {
        goalsScored: prev.goalsScored + delta.goalsScored,
        goalsConceded: prev.goalsConceded + delta.goalsConceded,
        penaltyGoalsScored:
          prev.penaltyGoalsScored + delta.penaltyGoalsScored,
        penaltiesMissed: prev.penaltiesMissed + delta.penaltiesMissed,
        cleanSheets: prev.cleanSheets + delta.cleanSheets,
        yellowCards: prev.yellowCards + delta.yellowCards,
        redCards: prev.redCards + delta.redCards,
      },
    };
    team.markModified('sportStats');
    await team.save();
  }

  private async applyPlayerContribution(
    row: FootballMatchStatsSnapshot['players'][0],
  ): Promise<void> {
    const user = await this.userModel.findById(row.userId);
    if (!user) {
      return;
    }

    const sportType = SportType.FOOTBALL;
    if (!user.playerSportStats) {
      user.playerSportStats = [];
    }
    let entry = user.playerSportStats.find((e) => e.sportType === sportType);
    if (!entry) {
      entry = { sportType, stats: emptyFootballPlayerStats() };
      user.playerSportStats.push(entry);
    }

    const prev = entry.stats as FootballPlayerStats;
    entry.stats = {
      matchesPlayed: prev.matchesPlayed + row.stats.matchesPlayed,
      matchesWon: prev.matchesWon + row.stats.matchesWon,
      goalsScored: prev.goalsScored + row.stats.goalsScored,
      assists: prev.assists + row.stats.assists,
      cleanSheets: prev.cleanSheets + row.stats.cleanSheets,
      saves: prev.saves + row.stats.saves,
      yellowCards: prev.yellowCards + row.stats.yellowCards,
      redCards: prev.redCards + row.stats.redCards,
      hatTricks: prev.hatTricks + row.stats.hatTricks,
      shotsOnTarget: prev.shotsOnTarget + row.stats.shotsOnTarget,
      penaltiesScored: prev.penaltiesScored + row.stats.penaltiesScored,
      penaltiesMissed: prev.penaltiesMissed + row.stats.penaltiesMissed,
      ownGoals: prev.ownGoals + row.stats.ownGoals,
    };
    user.markModified('playerSportStats');
    await user.save();
  }
}
