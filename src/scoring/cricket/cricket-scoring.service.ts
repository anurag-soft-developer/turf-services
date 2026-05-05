import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertCanActForTeam } from '../../matchmaking/util/matchmaking.helpers';
import {
  TeamMatch,
  TeamMatchDocument,
} from '../../matchmaking/schemas/team-match.schema';
import { TeamService } from '../../team/team.service';
import { TeamMemberService } from '../../team-member/team-member.service';
import { SportType } from '../../team/schemas/team.schema';
import {
  assertTeamMatchSport,
  assertTeamsAlignWithMatch,
  ensureActorTeamOnMatch,
  requireTeamMatchForScoring,
} from '../common/scoring.helpers';
import {
  CricketState,
  ScoringSession,
  ScoringSessionDocument,
} from '../common/scoring-session.schema';
import { ScoringSessionService } from '../common/scoring-session.service';
import { ScoringSessionStatus } from '../common/scoring.types';
import {
  CricketBallEvent,
  CricketBallEventDocument,
  CricketWicketKind,
} from './cricket-ball-event.schema';
import {
  AppendCricketBallDto,
  CreateCricketSessionDto,
  ListCricketBallsDto,
} from './dto/cricket-scoring.dto';
import { computeCricketPlayerPoints } from './cricket-points.calculator';

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
    @InjectModel(ScoringSession.name)
    private readonly scoringSessionModel: Model<ScoringSessionDocument>,
    @InjectModel(CricketBallEvent.name)
    private readonly ballEventModel: Model<CricketBallEventDocument>,
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    private readonly scoringSessionService: ScoringSessionService,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
  ) {}

  async createSession(
    userId: string,
    dto: CreateCricketSessionDto,
  ): Promise<ScoringSessionDocument> {
    const actorTeam = await this.teamService.requireTeam(dto.actorTeamId);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );

    let teamOneId: Types.ObjectId;
    let teamTwoId: Types.ObjectId;
    let teamMatchId: Types.ObjectId | undefined;

    if (dto.teamMatchId) {
      const match = await requireTeamMatchForScoring(
        this.teamMatchModel,
        dto.teamMatchId,
      );
      assertTeamMatchSport(match, SportType.CRICKET);
      ensureActorTeamOnMatch(match, new Types.ObjectId(dto.actorTeamId));
      teamOneId = match.fromTeam;
      teamTwoId = match.toTeam;
      assertTeamsAlignWithMatch(match, teamOneId, teamTwoId);
      teamMatchId = match._id;
    } else {
      if (!dto.teamOneId || !dto.teamTwoId) {
        throw new BadRequestException('teamOneId and teamTwoId are required');
      }
      teamOneId = new Types.ObjectId(dto.teamOneId);
      teamTwoId = new Types.ObjectId(dto.teamTwoId);
      const actorOid = new Types.ObjectId(dto.actorTeamId);
      if (
        actorOid.toString() !== teamOneId.toString() &&
        actorOid.toString() !== teamTwoId.toString()
      ) {
        throw new ForbiddenException('Actor team must be one of the two teams');
      }
    }

    const bat = new Types.ObjectId(dto.battingTeamId);
    const bowl = new Types.ObjectId(dto.bowlingTeamId);
    const t1 = teamOneId.toString();
    const t2 = teamTwoId.toString();
    const bs = bat.toString();
    const bws = bowl.toString();
    if (!((bs === t1 && bws === t2) || (bs === t2 && bws === t1))) {
      throw new BadRequestException(
        'battingTeamId and bowlingTeamId must be the two session teams',
      );
    }

    await this.assertUsersInTeams(dto, bat, bowl);

    const summaries = Array.from({ length: dto.maxInnings }, () => ({
      runs: 0,
      wickets: 0,
      legalBalls: 0,
    }));

    const cricketState: CricketState = {
      maxOvers: dto.maxOvers,
      maxInnings: dto.maxInnings,
      currentInnings: 1,
      battingTeamId: bat,
      bowlingTeamId: bowl,
      strikerUserId: new Types.ObjectId(dto.strikerUserId),
      nonStrikerUserId: new Types.ObjectId(dto.nonStrikerUserId),
      bowlerUserId: new Types.ObjectId(dto.bowlerUserId),
      inningsSummaries: summaries,
    };

    const doc = new this.scoringSessionModel({
      sport: SportType.CRICKET,
      teamMatchId,
      teamOneId,
      teamTwoId,
      status: ScoringSessionStatus.SCHEDULED,
      cricketState,
    });
    return doc.save();
  }

  async appendBall(
    userId: string,
    sessionId: string,
    dto: AppendCricketBallDto,
  ): Promise<CricketBallEventDocument> {
    const session = await this.scoringSessionService.requireSession(sessionId);
    this.scoringSessionService.assertSport(session, SportType.CRICKET);
    this.scoringSessionService.assertCanAppendEvents(session);
    if (!session.cricketState) {
      throw new BadRequestException('Invalid cricket session');
    }

    await this.assertLeadershipOnSessionTeams(userId, session);

    const cs = session.cricketState;
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

    await this.assertBattingBowlingRoster(session, striker, nonStriker, bowler);

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

    const last = await this.ballEventModel
      .findOne({ sessionId: session._id })
      .sort({ sequence: -1 })
      .lean();
    const sequence = (last?.sequence ?? 0) + 1;

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
      await this.assertUserOnTeam(incoming, cs.battingTeamId);
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
    if (inningsDone && cs.currentInnings < cs.maxInnings) {
      cs.currentInnings += 1;
      const tmp = cs.battingTeamId;
      cs.battingTeamId = cs.bowlingTeamId;
      cs.bowlingTeamId = tmp;
      cs.strikerUserId = undefined;
      cs.nonStrikerUserId = undefined;
      cs.bowlerUserId = undefined;
      session.status = ScoringSessionStatus.LIVE;
    } else if (inningsDone && cs.currentInnings >= cs.maxInnings) {
      session.status = ScoringSessionStatus.COMPLETED;
    } else {
      session.status = ScoringSessionStatus.LIVE;
    }

    const event = new this.ballEventModel({
      sessionId: session._id,
      sequence,
      innings: inningsForThisBall,
      overAfter,
      ballInOverAfter,
      strikerUserId: striker,
      nonStrikerUserId: nonStriker,
      bowlerUserId: bowler,
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

    await Promise.all([event.save(), session.save()]);

    return event;
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

  async getSessionView(sessionId: string): Promise<ScoringSessionDocument> {
    const session = await this.scoringSessionService.requireSession(sessionId);
    this.scoringSessionService.assertSport(session, SportType.CRICKET);
    return session;
  }

  async listBalls(sessionId: string, query: ListCricketBallsDto) {
    const session = await this.scoringSessionService.requireSession(sessionId);
    this.scoringSessionService.assertSport(session, SportType.CRICKET);
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.ballEventModel
        .find({ sessionId: session._id })
        .sort({ sequence: 1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.ballEventModel.countDocuments({ sessionId: session._id }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async getPoints(sessionId: string) {
    const session = await this.scoringSessionService.requireSession(sessionId);
    this.scoringSessionService.assertSport(session, SportType.CRICKET);
    const events = await this.ballEventModel
      .find({ sessionId: session._id })
      .sort({ sequence: 1 })
      .lean();
    return computeCricketPlayerPoints(events as CricketBallEvent[]);
  }

  private async assertUsersInTeams(
    dto: CreateCricketSessionDto,
    battingTeamId: Types.ObjectId,
    bowlingTeamId: Types.ObjectId,
  ): Promise<void> {
    await this.assertUserOnTeam(
      new Types.ObjectId(dto.strikerUserId),
      battingTeamId,
    );
    await this.assertUserOnTeam(
      new Types.ObjectId(dto.nonStrikerUserId),
      battingTeamId,
    );
    await this.assertUserOnTeam(
      new Types.ObjectId(dto.bowlerUserId),
      bowlingTeamId,
    );
  }

  private async assertUserOnTeam(
    userId: Types.ObjectId,
    teamId: Types.ObjectId,
  ): Promise<void> {
    const ok = await this.teamMemberService.hasActiveMembership(
      teamId.toString(),
      userId.toString(),
    );
    if (!ok) {
      throw new BadRequestException(
        `User ${userId.toString()} is not an active member of team ${teamId.toString()}`,
      );
    }
  }

  private async assertBattingBowlingRoster(
    session: ScoringSessionDocument,
    striker: Types.ObjectId,
    nonStriker: Types.ObjectId,
    bowler: Types.ObjectId,
  ): Promise<void> {
    const cs = session.cricketState!;
    await this.assertUserOnTeam(striker, cs.battingTeamId);
    await this.assertUserOnTeam(nonStriker, cs.battingTeamId);
    await this.assertUserOnTeam(bowler, cs.bowlingTeamId);
  }

  private async assertLeadershipOnSessionTeams(
    userId: string,
    session: ScoringSessionDocument,
  ): Promise<void> {
    const t1 = await this.teamService.requireTeam(session.teamOneId.toString());
    const t2 = await this.teamService.requireTeam(session.teamTwoId.toString());
    const can1 = await this.canLeadershipAct(t1, userId);
    const can2 = await this.canLeadershipAct(t2, userId);
    if (!can1 && !can2) {
      throw new ForbiddenException(
        'Only owners, captains, or vice captains of a session team can score',
      );
    }
  }

  private async canLeadershipAct(
    team: Awaited<ReturnType<TeamService['requireTeam']>>,
    userId: string,
  ): Promise<boolean> {
    try {
      await assertCanActForTeam(
        team,
        userId,
        this.teamService,
        this.teamMemberService,
      );
      return true;
    } catch {
      return false;
    }
  }
}
