import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { applyStatusUpdate } from '../../matchmaking/util/matchmaking.helpers';
import { TEAM_MATCH_POPULATE } from '../../matchmaking/util/matchmaking.constants';
import {
  FootballPeriod,
  FootballState,
  TeamMatch,
  TeamMatchDocument,
  TeamMatchSource,
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
import { resolveId } from '../../core/utils/mongo-ref.util';
import {
  FOOTBALL_EVENT_POPULATE,
  FootballMatchEvent,
  FootballMatchEventDocument,
} from './football-match-event.schema';
import {
  AppendFootballEventDto,
  ChangeFootballInningDto,
  CreateFootballSessionDto,
} from './dto/football-scoring.dto';
import {
  computeFootballMatchRankingPoints,
  computeFootballPlayerPoints,
} from './football-points.calculator';
import { FootballMatchStatsService } from './football-match-stats.service';
import { FootballRankingPointsService } from './football-ranking-points.service';
import { assertLeadershipOnMatchTeams } from './util/football-scoring.asserts';
import {
  createFootballInningsSummaries,
  defaultPeriodForInnings,
  finalizeFootballInningsSummary,
  FOOTBALL_INNINGS_PER_MATCH,
  pauseFootballTimer,
  resetFootballInningTimer,
  resumeFootballTimer,
} from './util/football-innings.helpers';
import { buildFootballEventFromPayload } from './util/football-event-build.helpers';
import {
  resolveFootballWinnerFromScore,
  revertMatchStateFromEvent,
} from './util/football-scoring.helpers';
import { initialActiveParticipantIds } from '../common/lineup.helpers';

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

    const inningsCount = dto.inningsPerMatch ?? FOOTBALL_INNINGS_PER_MATCH;
    const period = FootballPeriod.FIRST_HALF;
    const footballState: FootballState = {
      scoreTeamOne: 0,
      scoreTeamTwo: 0,
      currentInnings: 1,
      currentPeriod: period,
      matchMinute: dto.matchMinute,
      inningsSummaries: createFootballInningsSummaries(inningsCount, period),
      timerElapsedMs: 0,
      totalTimerElapsedMs: 0,
      isTimerPaused: true,
      fromTeamActiveParticipantIds: initialActiveParticipantIds(
        match,
        match.fromTeam.toString(),
      ),
      toTeamActiveParticipantIds: initialActiveParticipantIds(
        match,
        match.toTeam.toString(),
      ),
    };

    match.footballState = footballState;
    match.status = TeamMatchStatus.ONGOING;
    const saved = await (await match.save()).populate(TEAM_MATCH_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'football',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'football_create_session',
        footballState: saved.footballState,
        status: saved.status,
      },
    });

    return saved;
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

    const last = await this.footballEventModel
      .findOne({ teamMatchId: match._id })
      .sort({ sequence: -1 })
      .lean();
    const sequence = (last?.sequence ?? 0) + 1;

    const built = buildFootballEventFromPayload(
      this.footballEventModel,
      match,
      dto,
      sequence,
    );

    await Promise.all([built.save(), match.save()]);

    const populated = await built.populate(FOOTBALL_EVENT_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'football',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'football_append_event',
        event: populated,
        footballState: match.footballState,
        announcedPlayers: match.announcedPlayers,
      },
    });

    return populated;
  }

  async changeInning(
    userId: string,
    teamMatchId: string,
    dto: ChangeFootballInningDto,
  ): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    assertCanAppendScoringEvents(match);
    if (!match.footballState) {
      throw new BadRequestException('Football scoring not initialized');
    }

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const fs = match.footballState;
    const innIdx = fs.currentInnings - 1;
    finalizeFootballInningsSummary(fs, innIdx);

    if (fs.currentInnings >= fs.inningsSummaries.length) {
      throw new BadRequestException(
        'All innings are finished; use complete match to finalise the result',
      );
    }

    resetFootballInningTimer(fs);
    fs.currentInnings += 1;
    const nextIdx = fs.currentInnings - 1;
    const nextSummary = fs.inningsSummaries[nextIdx];
    if (nextSummary) {
      nextSummary.period =
        (dto.period as FootballPeriod | undefined) ??
        defaultPeriodForInnings(fs.currentInnings);
      fs.currentPeriod = nextSummary.period;
    }
    if (dto.matchMinute !== undefined) {
      fs.matchMinute = dto.matchMinute;
    }

    await match.save();
    const populated = await match.populate(TEAM_MATCH_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'football',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'football_change_inning',
        footballState: populated.footballState,
      },
    });

    return populated;
  }

  async pauseTimer(
    userId: string,
    teamMatchId: string,
  ): Promise<TeamMatchDocument> {
    const match = await this.requireFootballMatchForTimer(userId, teamMatchId);
    pauseFootballTimer(match.footballState!);
    await match.save();
    const populated = await match.populate(TEAM_MATCH_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'football',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'football_timer_pause',
        footballState: populated.footballState,
      },
    });

    return populated;
  }

  async resumeTimer(
    userId: string,
    teamMatchId: string,
  ): Promise<TeamMatchDocument> {
    const match = await this.requireFootballMatchForTimer(userId, teamMatchId);
    resumeFootballTimer(match.footballState!);
    await match.save();
    const populated = await match.populate(TEAM_MATCH_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'football',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'football_timer_resume',
        footballState: populated.footballState,
      },
    });

    return populated;
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

    const fs = match.footballState;
    finalizeFootballInningsSummary(fs, fs.currentInnings - 1);
    if (fs.currentInnings !== fs.inningsSummaries.length) {
      throw new BadRequestException(
        'Complete all innings before finishing the match',
      );
    }

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

    if (match.source !== TeamMatchSource.CASUAL) {
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
    }

    await match.save();
    const populated = await match.populate(TEAM_MATCH_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'football',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'football_complete_match',
        footballState: populated.footballState,
        status: populated.status,
        winnerTeamId: populated.winnerTeam
          ? resolveId(populated.winnerTeam)
          : null,
      },
    });

    return populated;
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
    return await this.footballEventModel
      .find({ teamMatchId: match._id })
      .sort({ sequence: 1 })
      .populate(FOOTBALL_EVENT_POPULATE)
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
        footballState: match.footballState,
        announcedPlayers: match.announcedPlayers,
        status: match.status,
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

    const players = computeFootballPlayerPoints(events as FootballMatchEvent[]);
    return { players, teams: [] };
  }

  private async requireFootballMatchForTimer(
    userId: string,
    teamMatchId: string,
  ): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    assertCanAppendScoringEvents(match);
    if (!match.footballState) {
      throw new BadRequestException('Football scoring not initialized');
    }
    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );
    return match;
  }
}
