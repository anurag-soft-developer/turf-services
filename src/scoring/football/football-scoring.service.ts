import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { applyStatusUpdate } from '../../matchmaking/util/matchmaking.helpers';
import { TEAM_MATCH_POPULATE } from '../../matchmaking/util/matchmaking.constants';
import {
  FootballPeriod,
  FootballState,
  TeamMatch,
  TeamMatchDocument,
  TeamMatchStatus,
} from '../../matchmaking/schemas/team-match.schema';
import { TeamService } from '../../team/team.service';
import { TeamMemberService } from '../../team-member/team-member.service';
import { SportType } from '../../team/schemas/team.schema';
import {
  assertCanAppendScoringEvents,
  assertTeamMatchSport,
  bumpMatchStatusToOngoingIfScheduled,
  requireTeamMatchForScoring,
} from '../common/scoring.helpers';
import { assertAnnouncedSquadsForSport } from '../common/scoring-squad.asserts';
import { ScoringRealtimeDispatcher } from '../common/scoring-realtime-dispatcher.service';
import {
  FootballEventKind,
  FootballMatchEvent,
  FootballMatchEventDocument,
} from './football-match-event.schema';
import {
  AppendFootballEventDto,
  CreateFootballSessionDto,
} from './dto/football-scoring.dto';
import {
  computeFootballMatchRankingPoints,
  computeFootballPlayerPoints,
} from './football-points.calculator';
import { FootballMatchStatsService } from './football-match-stats.service';
import { FootballRankingPointsService } from './football-ranking-points.service';
import {
  assertLeadershipOnMatchTeams,
  assertUserOnTeam,
} from './util/football-scoring.asserts';
import {
  resolveFootballWinnerFromScore,
  revertMatchStateFromEvent,
} from './util/football-scoring.helpers';

@Injectable()
export class FootballScoringService {
  constructor(
    @InjectModel(FootballMatchEvent.name)
    private readonly footballEventModel: Model<FootballMatchEventDocument>,
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
    private readonly realtimeDispatcher: ScoringRealtimeDispatcher,
    private readonly footballMatchStatsService: FootballMatchStatsService,
    private readonly footballRankingPointsService: FootballRankingPointsService,
  ) {}

  async createSession(
    userId: string,
    teamMatchId: string,
    dto: CreateFootballSessionDto,
  ): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );
    assertCanAppendScoringEvents(match);

    if (match.footballState) {
      throw new BadRequestException('Football scoring already initialized');
    }

    assertAnnouncedSquadsForSport(match, SportType.FOOTBALL);

    const footballState: FootballState = {
      scoreTeamOne: 0,
      scoreTeamTwo: 0,
      currentPeriod: dto.period as FootballPeriod,
      matchMinute: dto.matchMinute,
    };

    match.footballState = footballState;
    match.status = TeamMatchStatus.ONGOING;
    return await (await match.save()).populate(TEAM_MATCH_POPULATE);
  }

  async appendEvent(
    userId: string,
    teamMatchId: string,
    dto: AppendFootballEventDto,
  ): Promise<FootballMatchEventDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    assertCanAppendScoringEvents(match);
    if (!match.footballState) {
      throw new BadRequestException('Football scoring not initialized');
    }

    bumpMatchStatusToOngoingIfScheduled(match);

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const fs = match.footballState;
    fs.currentPeriod = dto.period as FootballPeriod;
    if (dto.matchMinute !== undefined) {
      fs.matchMinute = dto.matchMinute;
    }

    const last = await this.footballEventModel
      .findOne({ teamMatchId: match._id })
      .sort({ sequence: -1 })
      .lean();
    const sequence = (last?.sequence ?? 0) + 1;

    const built = await this.buildEventFromPayload(match, dto, sequence);

    await Promise.all([built.save(), match.save()]);

    await this.realtimeDispatcher.dispatch({
      sport: 'football',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: dto as unknown as Record<string, unknown>,
    });

    return built;
  }

  async completeMatch(
    userId: string,
    teamMatchId: string,
  ): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);

    if (
      match.status === TeamMatchStatus.COMPLETED ||
      match.status === TeamMatchStatus.DRAW
    ) {
      throw new BadRequestException('Match is already finished');
    }
    if (
      ![TeamMatchStatus.ONGOING, TeamMatchStatus.SCHEDULE_FINALIZED].includes(
        match.status,
      )
    ) {
      throw new BadRequestException(
        'Match must be ongoing to complete from scoring',
      );
    }

    if (!match.footballState) {
      throw new BadRequestException('Football scoring not initialized');
    }

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const winner = resolveFootballWinnerFromScore(match);
    const isDraw = winner === null;

    if (isDraw) {
      applyStatusUpdate(match, TeamMatchStatus.DRAW, userId);
      match.winnerTeam = undefined;
    } else {
      applyStatusUpdate(match, TeamMatchStatus.COMPLETED, userId);
      match.winnerTeam = winner;
    }
    match.closedAt = new Date();

    const events = await this.footballEventModel
      .find({ teamMatchId: match._id })
      .sort({ sequence: 1 })
      .lean();

    await this.footballMatchStatsService.applyMatchStats(
      match,
      events as FootballMatchEvent[],
      winner?.toString() ?? null,
      isDraw,
    );
    await this.footballRankingPointsService.applyMatchRankingPoints(
      match,
      events as FootballMatchEvent[],
      winner?.toString() ?? null,
      isDraw,
    );

    await match.save();

    await this.realtimeDispatcher.dispatch({
      sport: 'football',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: { kind: 'football_complete_match' },
    });

    return await match.populate(TEAM_MATCH_POPULATE);
  }

  async getSessionView(teamMatchId: string): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    return await match.populate(TEAM_MATCH_POPULATE);
  }

  async listEvents(teamMatchId: string): Promise<FootballMatchEventDocument[]> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    return this.footballEventModel
      .find({ teamMatchId: match._id })
      .sort({ sequence: 1 })
      .exec();
  }

  async undoLastEvent(
    userId: string,
    teamMatchId: string,
  ): Promise<FootballMatchEvent | null> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    if (!match.footballState) {
      throw new BadRequestException('Football scoring not initialized');
    }

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const lastEvent = await this.footballEventModel
      .findOne({ teamMatchId: match._id })
      .sort({ sequence: -1 });

    if (!lastEvent) {
      throw new BadRequestException('No event to undo');
    }

    const previous =
      lastEvent.sequence > 1
        ? await this.footballEventModel
            .findOne({
              teamMatchId: match._id,
              sequence: lastEvent.sequence - 1,
            })
            .lean()
        : null;

    const removed = lastEvent.toObject();
    revertMatchStateFromEvent(match, removed, previous);

    if (
      match.status === TeamMatchStatus.COMPLETED ||
      match.status === TeamMatchStatus.DRAW
    ) {
      match.status = TeamMatchStatus.ONGOING;
      match.winnerTeam = undefined;
      match.closedAt = undefined;
    }

    await lastEvent.deleteOne();
    await match.save();

    await this.realtimeDispatcher.dispatch({
      sport: 'football',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'undo_event',
      data: {
        eventId: lastEvent._id.toString(),
        removedEvent: removed,
      },
    });

    return removed;
  }

  async getPoints(teamMatchId: string) {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    const events = await this.footballEventModel
      .find({ teamMatchId: match._id })
      .sort({ sequence: 1 })
      .lean();

    const isFinished =
      match.status === TeamMatchStatus.COMPLETED ||
      match.status === TeamMatchStatus.DRAW;
    const winnerId = match.winnerTeam?.toString() ?? null;
    const isDraw = match.status === TeamMatchStatus.DRAW;

    if (isFinished) {
      const { players, teams } = computeFootballMatchRankingPoints(
        match,
        events as FootballMatchEvent[],
        winnerId,
        isDraw,
        { includeResultBonuses: true },
      );
      return { players, teams };
    }

    const players = computeFootballPlayerPoints(
      events as FootballMatchEvent[],
    );
    return { players, teams: [] };
  }

  private scoreDeltasForBeneficiary(
    match: TeamMatchDocument,
    beneficiaryTeamId: Types.ObjectId,
  ): { d1: number; d2: number } {
    const b = beneficiaryTeamId.toString();
    const t1 = match.fromTeam.toString();
    const t2 = match.toTeam.toString();
    if (b === t1) return { d1: 1, d2: 0 };
    if (b === t2) return { d1: 0, d2: 1 };
    throw new BadRequestException('beneficiaryTeamId must be a match team');
  }

  private async buildEventFromPayload(
    match: TeamMatchDocument,
    dto: AppendFootballEventDto,
    sequence: number,
  ): Promise<FootballMatchEventDocument> {
    const p = dto.payload;
    const fs = match.footballState!;

    switch (p.kind) {
      case 'goal': {
        const ben = new Types.ObjectId(p.beneficiaryTeamId);
        const scorer = new Types.ObjectId(p.scorerUserId);
        await assertUserOnTeam(this.teamMemberService, scorer, ben);
        if (p.assistUserId) {
          await assertUserOnTeam(
            this.teamMemberService,
            new Types.ObjectId(p.assistUserId),
            ben,
          );
        }
        const { d1, d2 } = this.scoreDeltasForBeneficiary(match, ben);
        fs.scoreTeamOne += d1;
        fs.scoreTeamTwo += d2;
        return new this.footballEventModel({
          teamMatchId: match._id,
          sequence,
          kind: FootballEventKind.GOAL,
          period: dto.period as FootballPeriod,
          matchMinute: dto.matchMinute,
          beneficiaryTeamId: ben,
          primaryUserId: scorer,
          secondaryUserId: p.assistUserId
            ? new Types.ObjectId(p.assistUserId)
            : undefined,
          scoreDeltaTeamOne: d1,
          scoreDeltaTeamTwo: d2,
        });
      }
      case 'own_goal': {
        const ben = new Types.ObjectId(p.beneficiaryTeamId);
        const conceding = new Types.ObjectId(p.concedingPlayerUserId);
        const concedingTeam = this.otherTeam(match, ben);
        await assertUserOnTeam(this.teamMemberService, conceding, concedingTeam);
        const { d1, d2 } = this.scoreDeltasForBeneficiary(match, ben);
        fs.scoreTeamOne += d1;
        fs.scoreTeamTwo += d2;
        return new this.footballEventModel({
          teamMatchId: match._id,
          sequence,
          kind: FootballEventKind.OWN_GOAL,
          period: dto.period as FootballPeriod,
          matchMinute: dto.matchMinute,
          beneficiaryTeamId: ben,
          primaryUserId: conceding,
          scoreDeltaTeamOne: d1,
          scoreDeltaTeamTwo: d2,
        });
      }
      case 'yellow_card': {
        const teamId = new Types.ObjectId(p.teamId);
        const player = new Types.ObjectId(p.playerUserId);
        await assertUserOnTeam(this.teamMemberService, player, teamId);
        return new this.footballEventModel({
          teamMatchId: match._id,
          sequence,
          kind: FootballEventKind.YELLOW_CARD,
          period: dto.period as FootballPeriod,
          matchMinute: dto.matchMinute,
          beneficiaryTeamId: teamId,
          primaryUserId: player,
          scoreDeltaTeamOne: 0,
          scoreDeltaTeamTwo: 0,
        });
      }
      case 'red_card': {
        const teamId = new Types.ObjectId(p.teamId);
        const player = new Types.ObjectId(p.playerUserId);
        await assertUserOnTeam(this.teamMemberService, player, teamId);
        return new this.footballEventModel({
          teamMatchId: match._id,
          sequence,
          kind: FootballEventKind.RED_CARD,
          period: dto.period as FootballPeriod,
          matchMinute: dto.matchMinute,
          beneficiaryTeamId: teamId,
          primaryUserId: player,
          scoreDeltaTeamOne: 0,
          scoreDeltaTeamTwo: 0,
        });
      }
      case 'substitution': {
        const teamId = new Types.ObjectId(p.teamId);
        await assertUserOnTeam(
          this.teamMemberService,
          new Types.ObjectId(p.playerOffUserId),
          teamId,
        );
        await assertUserOnTeam(
          this.teamMemberService,
          new Types.ObjectId(p.playerOnUserId),
          teamId,
        );
        return new this.footballEventModel({
          teamMatchId: match._id,
          sequence,
          kind: FootballEventKind.SUBSTITUTION,
          period: dto.period as FootballPeriod,
          matchMinute: dto.matchMinute,
          beneficiaryTeamId: teamId,
          primaryUserId: new Types.ObjectId(p.playerOffUserId),
          secondaryUserId: new Types.ObjectId(p.playerOnUserId),
          scoreDeltaTeamOne: 0,
          scoreDeltaTeamTwo: 0,
        });
      }
      case 'penalty_scored': {
        const ben = new Types.ObjectId(p.beneficiaryTeamId);
        const taker = new Types.ObjectId(p.takerUserId);
        await assertUserOnTeam(this.teamMemberService, taker, ben);
        const { d1, d2 } = this.scoreDeltasForBeneficiary(match, ben);
        fs.scoreTeamOne += d1;
        fs.scoreTeamTwo += d2;
        return new this.footballEventModel({
          teamMatchId: match._id,
          sequence,
          kind: FootballEventKind.PENALTY_SCORED,
          period: dto.period as FootballPeriod,
          matchMinute: dto.matchMinute,
          beneficiaryTeamId: ben,
          primaryUserId: taker,
          scoreDeltaTeamOne: d1,
          scoreDeltaTeamTwo: d2,
        });
      }
      case 'penalty_missed': {
        const teamId = new Types.ObjectId(p.teamId);
        const taker = new Types.ObjectId(p.takerUserId);
        await assertUserOnTeam(this.teamMemberService, taker, teamId);
        return new this.footballEventModel({
          teamMatchId: match._id,
          sequence,
          kind: FootballEventKind.PENALTY_MISSED,
          period: dto.period as FootballPeriod,
          matchMinute: dto.matchMinute,
          beneficiaryTeamId: teamId,
          primaryUserId: taker,
          scoreDeltaTeamOne: 0,
          scoreDeltaTeamTwo: 0,
        });
      }
      default:
        throw new BadRequestException('Unsupported football event');
    }
  }

  private otherTeam(
    match: TeamMatchDocument,
    teamId: Types.ObjectId,
  ): Types.ObjectId {
    const t = teamId.toString();
    if (t === match.fromTeam.toString()) return match.toTeam;
    if (t === match.toTeam.toString()) return match.fromTeam;
    throw new BadRequestException('Invalid team id');
  }
}
