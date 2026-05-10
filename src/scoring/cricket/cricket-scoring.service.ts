import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertCanActForTeam } from '../../matchmaking/util/matchmaking.helpers';
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
  CricketWicketKind,
} from './cricket-over-event.schema';
import { TEAM_MATCH_POPULATE } from '../../matchmaking/util/matchmaking.constants';
import {
  AppendCricketBallDto,
  CreateCricketSessionDto,
} from './dto/cricket-scoring.dto';
import { computeCricketPlayerPoints } from './cricket-points.calculator';
import {
  assertAnnouncedSquadsForCricket,
  assertBattingBowlingRoster,
  assertLeadershipOnMatchTeams,
  assertUserOnTeam,
  assertUsersInTeams,
} from './util/cricket-scoring.asserts';

/** Both teams bat (standard limited-overs). Mirrors [CricketState.inningsSummaries] length. */
const CRICKET_INNINGS_PER_MATCH = 2;

type OutcomeMapped = {
  runsOffBat: number;
  extrasWide: number;
  extrasNoBall: boolean;
  extrasBye: number;
  extrasLegBye: number;
  isWicket: boolean;
  wicketKind?: CricketWicketKind;
  totalRunsOnDelivery: number;
  isLegalDelivery: boolean;
  wicketsFallen: number;
  dismissedUserId?: Types.ObjectId;
  primaryFielderUserId?: Types.ObjectId;
};

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

    const summaries = Array.from({ length: CRICKET_INNINGS_PER_MATCH }, () => ({
      runs: 0,
      wickets: 0,
      legalBalls: 0,
    }));

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

    const mapped = this.mapOutcome(dto.outcome, striker);
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
    if (summary.wickets >= 10) {
      throw new BadRequestException('Innings is complete (all out)');
    }
    if (summary.legalBalls >= maxLegal) {
      throw new BadRequestException('Overs quota completed for this innings');
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
    let overAfter: number;
    let ballInOverAfter: number;
    if (mapped.isLegalDelivery) {
      const C = legalAfter;
      overAfter = Math.floor((C - 1) / 6);
      ballInOverAfter = ((C - 1) % 6) + 1;
    } else {
      const C = legalBefore;
      if (C === 0) {
        overAfter = 0;
        ballInOverAfter = 1;
      } else {
        overAfter = Math.floor((C - 1) / 6);
        ballInOverAfter = ((C - 1) % 6) + 1;
      }
    }

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

    const inningsDone = summary.wickets >= 10 || summary.legalBalls >= maxLegal;
    if (inningsDone && cs.currentInnings < cs.inningsSummaries.length) {
      cs.currentInnings += 1;
      const tmp = cs.battingTeamId;
      cs.battingTeamId = cs.bowlingTeamId;
      cs.bowlingTeamId = tmp;
      cs.strikerUserId = undefined;
      cs.nonStrikerUserId = undefined;
      cs.bowlerUserId = undefined;
    } else if (
      inningsDone &&
      cs.currentInnings >= cs.inningsSummaries.length
    ) {
      match.status = TeamMatchStatus.COMPLETED;
    }

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

  private mapOutcome(
    outcome: AppendCricketBallDto['outcome'],
    strikerUserId: Types.ObjectId,
  ): OutcomeMapped {
    switch (outcome.kind) {
      case 'dot':
        return {
          runsOffBat: 0,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: false,
          totalRunsOnDelivery: 0,
          isLegalDelivery: true,
          wicketsFallen: 0,
        };
      case 'runs':
        return {
          runsOffBat: outcome.offBat,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: false,
          totalRunsOnDelivery: outcome.offBat,
          isLegalDelivery: true,
          wicketsFallen: 0,
        };
      case 'wide': {
        const total = 1 + outcome.additionalRuns;
        return {
          runsOffBat: 0,
          extrasWide: total,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: false,
          totalRunsOnDelivery: total,
          isLegalDelivery: false,
          wicketsFallen: 0,
        };
      }
      case 'no_ball':
        return {
          runsOffBat: outcome.offBat,
          extrasWide: 0,
          extrasNoBall: true,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: false,
          totalRunsOnDelivery: 1 + outcome.offBat,
          isLegalDelivery: false,
          wicketsFallen: 0,
        };
      case 'bye':
        return {
          runsOffBat: 0,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: outcome.runs,
          extrasLegBye: 0,
          isWicket: false,
          totalRunsOnDelivery: outcome.runs,
          isLegalDelivery: true,
          wicketsFallen: 0,
        };
      case 'leg_bye':
        return {
          runsOffBat: 0,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: outcome.runs,
          isWicket: false,
          totalRunsOnDelivery: outcome.runs,
          isLegalDelivery: true,
          wicketsFallen: 0,
        };
      case 'wicket_bowled':
        return {
          runsOffBat: outcome.offBat,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: true,
          wicketKind: CricketWicketKind.BOWLED,
          dismissedUserId: strikerUserId,
          totalRunsOnDelivery: outcome.offBat,
          isLegalDelivery: true,
          wicketsFallen: 1,
        };
      case 'wicket_caught':
        return {
          runsOffBat: outcome.offBat,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: true,
          wicketKind: CricketWicketKind.CAUGHT,
          dismissedUserId: strikerUserId,
          primaryFielderUserId: new Types.ObjectId(outcome.fielderUserId),
          totalRunsOnDelivery: outcome.offBat,
          isLegalDelivery: true,
          wicketsFallen: 1,
        };
      case 'wicket_lbw':
        return {
          runsOffBat: outcome.offBat,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: true,
          wicketKind: CricketWicketKind.LBW,
          dismissedUserId: strikerUserId,
          totalRunsOnDelivery: outcome.offBat,
          isLegalDelivery: true,
          wicketsFallen: 1,
        };
      case 'wicket_run_out':
        return {
          runsOffBat: outcome.runsOffBat,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: true,
          wicketKind: CricketWicketKind.RUN_OUT,
          dismissedUserId: new Types.ObjectId(outcome.dismissedUserId),
          primaryFielderUserId: outcome.fielderUserId
            ? new Types.ObjectId(outcome.fielderUserId)
            : undefined,
          totalRunsOnDelivery: outcome.runsOffBat,
          isLegalDelivery: true,
          wicketsFallen: 1,
        };
      case 'wicket_stumped':
        return {
          runsOffBat: outcome.offBat,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: true,
          wicketKind: CricketWicketKind.STUMPED,
          dismissedUserId: strikerUserId,
          primaryFielderUserId: new Types.ObjectId(outcome.wicketKeeperUserId),
          totalRunsOnDelivery: outcome.offBat,
          isLegalDelivery: true,
          wicketsFallen: 1,
        };
      case 'wicket_hit_wicket':
        return {
          runsOffBat: outcome.offBat,
          extrasWide: 0,
          extrasNoBall: false,
          extrasBye: 0,
          extrasLegBye: 0,
          isWicket: true,
          wicketKind: CricketWicketKind.HIT_WICKET,
          dismissedUserId: strikerUserId,
          totalRunsOnDelivery: outcome.offBat,
          isLegalDelivery: true,
          wicketsFallen: 1,
        };
      default:
        throw new BadRequestException('Unsupported outcome');
    }
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

}
