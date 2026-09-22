import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { applyStatusUpdate } from '../../matchmaking/util/matchmaking.helpers';
import {
  CricketState,
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
  CRICKET_OVER_EVENT_POPULATE,
  CricketOverEvent,
  CricketOverEventDocument,
  isCricketBallEntry,
  isCricketSubstitutionEntry,
} from './cricket-over-event.schema';
import { TEAM_MATCH_POPULATE } from '../../matchmaking/util/matchmaking.constants';
import {
  AppendCricketBallDto,
  AppendCricketSubstitutionDto,
  CreateCricketSessionDto,
  UpdateCricketStateDto,
} from './dto/cricket-scoring.dto';
import {
  initialActiveParticipantIds,
  applySubstitution,
  revertSubstitution,
} from '../common/lineup.helpers';
import {
  computeCricketMatchRankingPoints,
  computeCricketPlayerPoints,
} from './cricket-points.calculator';
import { CricketMatchStatsService } from './cricket-match-stats.service';
import { CricketRankingPointsService } from './cricket-ranking-points.service';
import {
  assertAnnouncedPlayingLineup,
  assertAnnouncedPlayingParticipant,
  assertLeadershipOnMatchTeams,
  assertUsersInAnnouncedLineup,
} from './util/cricket-scoring.asserts';
import {
  CRICKET_INNINGS_PER_MATCH,
  computeOverAndBallAfter,
  finalizeInningsSummaryTeams,
  getDismissedBatsmenUserIds,
  isCricketInningsComplete,
  mapCricketOutcome,
  resolveCricketWinnerFromInnings,
  revertMatchStateFromBall,
} from './util/cricket-scoring.helpers';
import {
  findLatestScoringEntry,
  makeBallScoringEntry,
  makeSubstitutionScoringEntry,
  resolveTargetOverDoc,
} from './util/cricket-over-routing.helpers';

@Injectable()
export class CricketScoringService {
  constructor(
    @InjectModel(CricketOverEvent.name)
    private readonly overEventModel: Model<CricketOverEventDocument>,
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
    private readonly realtimeDispatcher: ScoringRealtimeDispatcher,
    private readonly cricketMatchStatsService: CricketMatchStatsService,
    private readonly cricketRankingPointsService: CricketRankingPointsService,
  ) {}

  async createSession(
    userId: string,
    teamMatchId: string,
    dto: CreateCricketSessionDto,
  ): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );
    assertCanAppendScoringEvents(match);

    if (match.cricketState) {
      throw new BadRequestException('Cricket scoring already initialized');
    }

    const teamOneId = match.fromTeam;
    const teamTwoId = match.toTeam;

    const bat = new Types.ObjectId(dto.battingTeamId);
    const bowl = new Types.ObjectId(dto.bowlingTeamId);
    const t1 = teamOneId.toString();
    const t2 = teamTwoId.toString();
    const bs = bat.toString();
    const bws = bowl.toString();
    if (!((bs === t1 && bws === t2) || (bs === t2 && bws === t1))) {
      throw new BadRequestException(
        'battingTeamId and bowlingTeamId must be the two teams on the match',
      );
    }

    assertAnnouncedSquadsForSport(match, SportType.CRICKET);

    assertUsersInAnnouncedLineup(match, dto, bat, bowl);

    const summaries = Array.from(
      { length: CRICKET_INNINGS_PER_MATCH },
      (_, i) => ({
        runs: 0,
        wickets: 0,
        legalBalls: 0,
        ...(i === 0 ? { battingTeamId: bat, bowlingTeamId: bowl } : {}),
      }),
    );

    const cricketState: CricketState = {
      maxOvers: dto.maxOvers,
      currentInnings: 1,
      battingTeamId: bat,
      bowlingTeamId: bowl,
      inningsSummaries: summaries,
      fromTeamActiveParticipantIds: initialActiveParticipantIds(
        match,
        teamOneId.toString(),
      ),
      toTeamActiveParticipantIds: initialActiveParticipantIds(
        match,
        teamTwoId.toString(),
      ),
      ...(dto.strikerUserId
        ? { strikerUserId: new Types.ObjectId(dto.strikerUserId) }
        : {}),
      ...(dto.nonStrikerUserId
        ? { nonStrikerUserId: new Types.ObjectId(dto.nonStrikerUserId) }
        : {}),
      ...(dto.bowlerUserId
        ? { bowlerUserId: new Types.ObjectId(dto.bowlerUserId) }
        : {}),
    };

    match.cricketState = cricketState;
    match.status = TeamMatchStatus.ONGOING;
    const saved = await (await match.save()).populate(TEAM_MATCH_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'cricket_create_session',
        cricketState: saved.cricketState,
        status: saved.status,
      },
    });

    return saved;
  }

  async appendBall(
    userId: string,
    teamMatchId: string,
    dto: AppendCricketBallDto,
  ): Promise<CricketOverEventDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    assertCanAppendScoringEvents(match);
    if (!match.cricketState) {
      throw new BadRequestException('Cricket scoring not initialized');
    }

    bumpMatchStatusToOngoingIfScheduled(match);

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const cs = match.cricketState;
    const inningsForThisBall = cs.currentInnings;
    const innIdx = cs.currentInnings - 1;
    const summary = cs.inningsSummaries[innIdx];
    if (!summary) {
      throw new BadRequestException('Invalid innings');
    }

    const striker = new Types.ObjectId(dto.strikerUserId);
    const nonStriker = new Types.ObjectId(dto.nonStrikerUserId);
    const bowler = new Types.ObjectId(dto.bowlerUserId);

    const mapped = mapCricketOutcome(dto.outcome, striker);
    const wicketsAfter =
      summary.wickets + (mapped.isWicket ? mapped.wicketsFallen : 0);
    const willCompleteAllOut = mapped.isWicket && wicketsAfter >= 10;
    if (
      mapped.isWicket &&
      mapped.wicketsFallen > 0 &&
      !willCompleteAllOut &&
      !dto.incomingBatsmanUserId
    ) {
      throw new BadRequestException(
        'incomingBatsmanUserId is required when a wicket falls',
      );
    }

    assertAnnouncedPlayingLineup(
      match,
      cs.battingTeamId,
      cs.bowlingTeamId,
      striker,
      nonStriker,
      bowler,
    );

    const maxLegal = cs.maxOvers * 6;
    if (isCricketInningsComplete(cs, innIdx, maxLegal)) {
      throw new BadRequestException('change inning');
    }
    if (mapped.isLegalDelivery && summary.legalBalls + 1 > maxLegal) {
      throw new BadRequestException(
        'This legal delivery would exceed overs quota',
      );
    }

    const legalBefore = summary.legalBalls;

    summary.runs += mapped.totalRunsOnDelivery;
    if (mapped.isLegalDelivery) {
      summary.legalBalls += 1;
    }
    if (mapped.isWicket) {
      summary.wickets += mapped.wicketsFallen;
    }

    const legalAfter = summary.legalBalls;
    const { overAfter, ballInOverAfter } = computeOverAndBallAfter(
      legalBefore,
      legalAfter,
      mapped.isLegalDelivery,
    );

    const dismissed = mapped.dismissedUserId;
    if (mapped.isWicket && !willCompleteAllOut && dto.incomingBatsmanUserId) {
      const incoming = new Types.ObjectId(dto.incomingBatsmanUserId);
      assertAnnouncedPlayingParticipant(
        match,
        cs.battingTeamId,
        incoming,
        'Incoming batsman',
      );
      if (!dismissed) {
        throw new BadRequestException('Dismissed batsman not set for wicket');
      }
      if (resolveId(dismissed) === resolveId(striker)) {
        cs.strikerUserId = incoming;
        cs.nonStrikerUserId = nonStriker;
      } else if (resolveId(dismissed) === resolveId(nonStriker)) {
        cs.strikerUserId = striker;
        cs.nonStrikerUserId = incoming;
      } else {
        throw new BadRequestException(
          'dismissed batsman must be striker or non-striker',
        );
      }
    } else if (!mapped.isWicket) {
      let s = striker;
      let n = nonStriker;
      if (mapped.totalRunsOnDelivery % 2 === 1) {
        [s, n] = [n, s];
      }
      if (mapped.isLegalDelivery && legalAfter > 0 && legalAfter % 6 === 0) {
        [s, n] = [n, s];
      }
      cs.strikerUserId = s;
      cs.nonStrikerUserId = n;
    }

    cs.bowlerUserId = bowler;

    const ballPayload = makeBallScoringEntry({
      ballInOverAfter,
      strikerUserId: striker,
      nonStrikerUserId: nonStriker,
      runsOffBat: mapped.runsOffBat,
      extrasWide: mapped.extrasWide,
      extrasNoBall: mapped.extrasNoBall,
      extrasBye: mapped.extrasBye,
      extrasLegBye: mapped.extrasLegBye,
      isWicket: mapped.isWicket,
      wicketKind: mapped.wicketKind,
      dismissedUserId: mapped.dismissedUserId,
      primaryFielderUserId: mapped.primaryFielderUserId,
      totalRunsOnDelivery: mapped.totalRunsOnDelivery,
      isLegalDelivery: mapped.isLegalDelivery,
      wicketsFallen: mapped.wicketsFallen,
    });

    let overDoc = await this.overEventModel.findOne({
      teamMatchId: match._id,
      innings: inningsForThisBall,
      overAfter,
    });

    if (!overDoc) {
      const lastOver = await this.overEventModel
        .findOne({ teamMatchId: match._id })
        .sort({ sequence: -1 })
        .lean();
      const overSequence = (lastOver?.sequence ?? 0) + 1;
      overDoc = new this.overEventModel({
        teamMatchId: match._id,
        bowlerUserId: bowler,
        sequence: overSequence,
        innings: inningsForThisBall,
        overAfter,
        events: [ballPayload],
      });
    } else {
      if (
        overDoc.bowlerUserId &&
        resolveId(overDoc.bowlerUserId) !== resolveId(bowler)
      ) {
        throw new BadRequestException(
          'bowlerUserId must match the bowler for this over',
        );
      }
      if (!overDoc.bowlerUserId) {
        overDoc.bowlerUserId = bowler;
      }
      overDoc.events.push(ballPayload);
    }

    await Promise.all([overDoc.save(), match.save()]);

    const populatedOver = await overDoc.populate(CRICKET_OVER_EVENT_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_ball',
      data: {
        over: populatedOver,
        cricketState: match.cricketState,
        announcedPlayers: match.announcedPlayers,
      },
    });

    return populatedOver;
  }

  async appendSubstitution(
    userId: string,
    teamMatchId: string,
    dto: AppendCricketSubstitutionDto,
  ): Promise<CricketOverEventDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    assertCanAppendScoringEvents(match);
    if (!match.cricketState) {
      throw new BadRequestException('Cricket scoring not initialized');
    }

    bumpMatchStatusToOngoingIfScheduled(match);

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const cs = match.cricketState;
    const teamId = new Types.ObjectId(dto.teamId);
    const playerOff = new Types.ObjectId(dto.playerOffParticipantId);
    const playerOn = new Types.ObjectId(dto.playerOnParticipantId);

    applySubstitution(match, cs, teamId, playerOff, playerOn);

    const subEntry = makeSubstitutionScoringEntry({
      teamId,
      playerOffParticipantId: playerOff,
      playerOnParticipantId: playerOn,
    });

    let overDoc = await resolveTargetOverDoc(
      this.overEventModel,
      match._id,
      cs,
    );

    if (!overDoc) {
      const lastOver = await this.overEventModel
        .findOne({ teamMatchId: match._id })
        .sort({ sequence: -1 })
        .lean();
      const overSequence = (lastOver?.sequence ?? 0) + 1;
      const summary = cs.inningsSummaries[cs.currentInnings - 1];
      const legalBalls = summary?.legalBalls ?? 0;
      const overAfter =
        legalBalls === 0 ? 0 : Math.floor((legalBalls - 1) / 6);
      overDoc = new this.overEventModel({
        teamMatchId: match._id,
        sequence: overSequence,
        innings: cs.currentInnings,
        overAfter,
        events: [subEntry],
      });
    } else {
      overDoc.events.push(subEntry);
    }

    await Promise.all([overDoc.save(), match.save()]);

    const populatedOver = await overDoc.populate(CRICKET_OVER_EVENT_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_substitution',
      data: {
        over: populatedOver,
        cricketState: match.cricketState,
        announcedPlayers: match.announcedPlayers,
      },
    });

    return populatedOver;
  }

  async changeInning(
    userId: string,
    teamMatchId: string,
  ): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    assertCanAppendScoringEvents(match);
    if (!match.cricketState) {
      throw new BadRequestException('Cricket scoring not initialized');
    }

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const cs = match.cricketState;
    const innIdx = cs.currentInnings - 1;
    const summary = cs.inningsSummaries[innIdx];
    if (!summary) {
      throw new BadRequestException('Invalid innings');
    }

    const maxLegal = cs.maxOvers * 6;
    if (!isCricketInningsComplete(cs, innIdx, maxLegal)) {
      throw new BadRequestException('Current innings is not complete');
    }

    if (cs.currentInnings >= cs.inningsSummaries.length) {
      throw new BadRequestException(
        'All innings are finished; use complete match to finalise the result',
      );
    }

    finalizeInningsSummaryTeams(cs, innIdx);
    cs.currentInnings += 1;
    const tmp = cs.battingTeamId;
    cs.battingTeamId = cs.bowlingTeamId;
    cs.bowlingTeamId = tmp;
    cs.strikerUserId = undefined;
    cs.nonStrikerUserId = undefined;
    cs.bowlerUserId = undefined;

    const nextIdx = cs.currentInnings - 1;
    const nextSummary = cs.inningsSummaries[nextIdx];
    if (nextSummary) {
      nextSummary.battingTeamId = cs.battingTeamId;
      nextSummary.bowlingTeamId = cs.bowlingTeamId;
    }

    await match.save();
    const populated = await match.populate(TEAM_MATCH_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'cricket_change_inning',
        cricketState: populated.cricketState,
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
    assertTeamMatchSport(match, SportType.CRICKET);

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

    if (!match.cricketState) {
      throw new BadRequestException('Cricket scoring not initialized');
    }

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const cs = match.cricketState;
    const maxLegal = cs.maxOvers * 6;

    if (cs.currentInnings !== cs.inningsSummaries.length) {
      throw new BadRequestException(
        'Complete earlier innings before finishing the match',
      );
    }

    const innIdx = cs.currentInnings - 1;
    if (!isCricketInningsComplete(cs, innIdx, maxLegal)) {
      throw new BadRequestException('Current innings is not complete');
    }

    for (let i = 0; i < cs.inningsSummaries.length; i++) {
      finalizeInningsSummaryTeams(cs, i);
      if (!isCricketInningsComplete(cs, i, maxLegal)) {
        throw new BadRequestException('Not all innings are complete');
      }
    }

    const winner = resolveCricketWinnerFromInnings(match);
    if (winner === null) {
      applyStatusUpdate(match, TeamMatchStatus.DRAW, userId);
      match.winnerTeam = undefined;
    } else {
      applyStatusUpdate(match, TeamMatchStatus.COMPLETED, userId);
      match.winnerTeam = winner;
    }
    match.closedAt = new Date();

    const overs = await this.overEventModel
      .find({ teamMatchId: match._id })
      .exec();
    if (match.source !== TeamMatchSource.CASUAL) {
      await this.cricketMatchStatsService.applyMatchStats(
        match,
        overs,
        winner?.toString() ?? null,
        winner === null,
      );
      await this.cricketRankingPointsService.applyMatchRankingPoints(
        match,
        overs,
        winner?.toString() ?? null,
        winner === null,
      );
    }

    await match.save();
    const populated = await match.populate(TEAM_MATCH_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'cricket_complete_match',
        cricketState: populated.cricketState,
        status: populated.status,
        winnerTeamId: populated.winnerTeam
          ? resolveId(populated.winnerTeam)
          : null,
      },
    });

    return populated;
  }

  async undoLastScoringEntry(
    userId: string,
    teamMatchId: string,
  ): Promise<CricketOverEventDocument | null> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    if (!match.cricketState) {
      throw new BadRequestException('Cricket scoring not initialized');
    }

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const latest = await findLatestScoringEntry(
      this.overEventModel,
      match._id,
    );
    if (!latest) {
      throw new BadRequestException('No scoring entry to undo');
    }

    const { overDoc, entry, indexInEvents } = latest;
    overDoc.events.splice(indexInEvents, 1);

    if (isCricketBallEntry(entry)) {
      revertMatchStateFromBall(match, overDoc, entry);
    } else if (isCricketSubstitutionEntry(entry)) {
      revertSubstitution(
        match,
        match.cricketState,
        entry.teamId,
        entry.playerOffParticipantId,
        entry.playerOnParticipantId,
      );
    } else {
      throw new BadRequestException('Unsupported scoring entry kind');
    }

    if (
      match.status === TeamMatchStatus.COMPLETED ||
      match.status === TeamMatchStatus.DRAW
    ) {
      match.status = TeamMatchStatus.ONGOING;
      match.winnerTeam = undefined;
      match.closedAt = undefined;
    }

    const overId = overDoc._id.toString();
    let savedOver: CricketOverEventDocument | null = overDoc;
    if (overDoc.events.length === 0) {
      await overDoc.deleteOne();
      savedOver = null;
    } else {
      await overDoc.save();
    }

    await match.save();

    const populatedOver = savedOver
      ? await savedOver.populate(CRICKET_OVER_EVENT_POPULATE)
      : null;

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'undo_scoring_entry',
      data: {
        overId,
        removedEntry: entry,
        over: populatedOver,
        cricketState: match.cricketState,
        announcedPlayers: match.announcedPlayers,
        status: match.status,
      },
    });

    return populatedOver;
  }

  async getSessionView(teamMatchId: string): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    return await match.populate(TEAM_MATCH_POPULATE);
  }

  async listOvers(teamMatchId: string): Promise<CricketOverEventDocument[]> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    return this.overEventModel
      .find({ teamMatchId: match._id })
      .sort({ sequence: 1 })
      .populate(CRICKET_OVER_EVENT_POPULATE)
      .exec();
  }

  async getPoints(teamMatchId: string) {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    const overs = await this.overEventModel
      .find({ teamMatchId: match._id })
      .sort({ sequence: 1 })
      .lean();

    const isFinished =
      match.status === TeamMatchStatus.COMPLETED ||
      match.status === TeamMatchStatus.DRAW;
    const winnerId = match.winnerTeam?.toString() ?? null;
    const isDraw = match.status === TeamMatchStatus.DRAW;

    if (isFinished) {
      const { players, teams } = computeCricketMatchRankingPoints(
        match,
        overs,
        winnerId,
        isDraw,
        { includeResultBonuses: true },
      );
      return { players, teams };
    }

    const players = computeCricketPlayerPoints(
      overs.map((o) => ({
        bowlerUserId: o.bowlerUserId,
        events: o.events,
        innings: o.innings,
      })),
    );
    return { players, teams: [] };
  }

  async updateCricketState(
    userId: string,
    teamMatchId: string,
    dto: UpdateCricketStateDto,
  ): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    assertCanAppendScoringEvents(match);
    if (!match.cricketState) {
      throw new BadRequestException('Cricket scoring not initialized');
    }

    await assertLeadershipOnMatchTeams(
      this.teamService,
      this.teamMemberService,
      userId,
      match,
    );

    const cs = match.cricketState;
    const nextStriker =
      dto.strikerUserId !== undefined
        ? new Types.ObjectId(dto.strikerUserId)
        : cs.strikerUserId;
    const nextNonStriker =
      dto.nonStrikerUserId !== undefined
        ? new Types.ObjectId(dto.nonStrikerUserId)
        : cs.nonStrikerUserId;
    const nextBowler =
      dto.bowlerUserId !== undefined
        ? new Types.ObjectId(dto.bowlerUserId)
        : cs.bowlerUserId;

    if (!nextStriker || !nextNonStriker || !nextBowler) {
      throw new BadRequestException(
        'Striker, non-striker and bowler must all be set (include missing IDs in the request)',
      );
    }

    if (resolveId(nextStriker) === resolveId(nextNonStriker)) {
      throw new BadRequestException(
        'Striker and non-striker must be different players',
      );
    }

    assertAnnouncedPlayingLineup(
      match,
      cs.battingTeamId,
      cs.bowlingTeamId,
      nextStriker,
      nextNonStriker,
      nextBowler,
    );

    const dismissed = await getDismissedBatsmenUserIds(
      this.overEventModel,
      match._id,
      cs.currentInnings,
    );
    for (const uid of [nextStriker, nextNonStriker]) {
      if (dismissed.has(uid.toString())) {
        throw new BadRequestException(
          'Cannot assign an out batsman as striker or non-striker',
        );
      }
    }

    cs.strikerUserId = nextStriker;
    cs.nonStrikerUserId = nextNonStriker;
    cs.bowlerUserId = nextBowler;

    await match.save();
    const populated = await match.populate(TEAM_MATCH_POPULATE);

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'cricket_update_lineup',
        cricketState: populated.cricketState,
      },
    });

    return populated;
  }
}
