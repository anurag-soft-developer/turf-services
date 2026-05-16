import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  applyStatusUpdate,
  assertCanActForTeam,
} from '../../matchmaking/util/matchmaking.helpers';
import {
  CricketState,
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
  ensureActorTeamOnMatch,
  requireTeamMatchForScoring,
} from '../common/scoring.helpers';
import { ScoringRealtimeDispatcher } from '../common/scoring-realtime-dispatcher.service';
import {
  CRICKET_OVER_EVENT_POPULATE,
  CricketBallEvent,
  CricketOverEvent,
  CricketOverEventDocument,
} from './cricket-over-event.schema';
import { TEAM_MATCH_POPULATE } from '../../matchmaking/util/matchmaking.constants';
import {
  AppendCricketBallDto,
  CompleteCricketMatchDto,
  CreateCricketSessionDto,
  UpdateCricketStateDto,
} from './dto/cricket-scoring.dto';
import { computeCricketPlayerPoints } from './cricket-points.calculator';
import { CricketMatchStatsService } from './cricket-match-stats.service';
import {
  assertAnnouncedPlayingLineup,
  assertAnnouncedSquadsForCricket,
  assertBattingBowlingRoster,
  assertLeadershipOnMatchTeams,
  assertUserOnTeam,
  assertUsersInTeams,
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
  ) {}

  async createSession(
    userId: string,
    teamMatchId: string,
    dto: CreateCricketSessionDto,
  ): Promise<TeamMatchDocument> {
    const actorTeam = await this.teamService.requireTeam(dto.actorTeamId);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );

    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.CRICKET);
    ensureActorTeamOnMatch(match, new Types.ObjectId(dto.actorTeamId));
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

    assertAnnouncedSquadsForCricket(match);

    await assertUsersInTeams(this.teamMemberService, dto, bat, bowl);

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
    return await (await match.save()).populate(TEAM_MATCH_POPULATE);
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

    await assertBattingBowlingRoster(
      this.teamMemberService,
      match,
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
      await assertUserOnTeam(
        this.teamMemberService,
        incoming,
        cs.battingTeamId,
      );
      if (!dismissed) {
        throw new BadRequestException('Dismissed batsman not set for wicket');
      }
      if (dismissed.toString() === striker.toString()) {
        cs.strikerUserId = incoming;
        cs.nonStrikerUserId = nonStriker;
      } else if (dismissed.toString() === nonStriker.toString()) {
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

    const ballPayload: CricketBallEvent = {
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
    };

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
        ballEvents: [ballPayload],
      });
    } else {
      if (overDoc.bowlerUserId.toString() !== bowler.toString()) {
        throw new BadRequestException(
          'bowlerUserId must match the bowler for this over',
        );
      }
      overDoc.ballEvents.push(ballPayload);
    }

    await Promise.all([overDoc.save(), match.save()]);

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_ball',
      data: dto as unknown as Record<string, unknown>,
    });

    return await overDoc.populate(CRICKET_OVER_EVENT_POPULATE);
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

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: { kind: 'cricket_change_inning' },
    });

    return await match.populate(TEAM_MATCH_POPULATE);
  }

  async completeMatch(
    userId: string,
    teamMatchId: string,
    dto: CompleteCricketMatchDto,
  ): Promise<TeamMatchDocument> {
    const actorTeam = await this.teamService.requireTeam(dto.actorTeamId);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );

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
    await this.cricketMatchStatsService.applyMatchStats(
      match,
      overs,
      winner?.toString() ?? null,
      winner === null,
    );

    await match.save();

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: { kind: 'cricket_complete_match' },
    });

    return await match.populate(TEAM_MATCH_POPULATE);
  }

  async undoLastBall(
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

    const overDoc = await this.overEventModel
      .findOne({
        teamMatchId: match._id,
        'ballEvents.0': { $exists: true },
      })
      .sort({ sequence: -1 });

    if (!overDoc || overDoc.ballEvents.length === 0) {
      throw new BadRequestException('No ball to undo');
    }

    const removedBall = overDoc.ballEvents[overDoc.ballEvents.length - 1];
    overDoc.ballEvents.pop();

    revertMatchStateFromBall(match, overDoc, removedBall);

    if (
      match.status === TeamMatchStatus.COMPLETED ||
      match.status === TeamMatchStatus.DRAW
    ) {
      match.status = TeamMatchStatus.ONGOING;
      match.winnerTeam = undefined;
      match.closedAt = undefined;
    }

    let savedOver: CricketOverEventDocument | null = overDoc;
    if (overDoc.ballEvents.length === 0) {
      await overDoc.deleteOne();
      savedOver = null;
    } else {
      await overDoc.save();
    }

    await match.save();

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'undo_ball',
      data: {
        overId: overDoc._id.toString(),
        removedBall,
      },
    });

    if (!savedOver) {
      return null;
    }

    return await savedOver.populate(CRICKET_OVER_EVENT_POPULATE);
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
    return computeCricketPlayerPoints(
      overs.map((o) => ({
        bowlerUserId: o.bowlerUserId,
        ballEvents: o.ballEvents,
      })),
    );
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

    const actorTeam = await this.teamService.requireTeam(dto.actorTeamId);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    ensureActorTeamOnMatch(match, new Types.ObjectId(dto.actorTeamId));

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

    if (nextStriker.toString() === nextNonStriker.toString()) {
      throw new BadRequestException(
        'Striker and non-striker must be different players',
      );
    }

    await assertBattingBowlingRoster(
      this.teamMemberService,
      match,
      nextStriker,
      nextNonStriker,
      nextBowler,
    );
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
      match._id as Types.ObjectId,
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

    await this.realtimeDispatcher.dispatch({
      sport: 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'cricket_update_lineup',
        strikerUserId: nextStriker.toString(),
        nonStrikerUserId: nextNonStriker.toString(),
        bowlerUserId: nextBowler.toString(),
      },
    });

    return await match.populate(TEAM_MATCH_POPULATE);
  }
}
