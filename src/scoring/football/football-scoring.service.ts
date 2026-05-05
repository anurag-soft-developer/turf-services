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
  FootballPeriod,
  FootballState,
  ScoringSession,
  ScoringSessionDocument,
} from '../common/scoring-session.schema';
import { ScoringSessionService } from '../common/scoring-session.service';
import { ScoringSessionStatus } from '../common/scoring.types';
import {
  FootballEventKind,
  FootballMatchEvent,
  FootballMatchEventDocument,
} from './football-match-event.schema';
import {
  AppendFootballEventDto,
  CreateFootballSessionDto,
  ListFootballEventsDto,
} from './dto/football-scoring.dto';
import { computeFootballPlayerPoints } from './football-points.calculator';

@Injectable()
export class FootballScoringService {
  constructor(
    @InjectModel(ScoringSession.name)
    private readonly scoringSessionModel: Model<ScoringSessionDocument>,
    @InjectModel(FootballMatchEvent.name)
    private readonly footballEventModel: Model<FootballMatchEventDocument>,
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    private readonly scoringSessionService: ScoringSessionService,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
  ) {}

  async createSession(
    userId: string,
    dto: CreateFootballSessionDto,
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
      assertTeamMatchSport(match, SportType.FOOTBALL);
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

    const footballState: FootballState = {
      scoreTeamOne: 0,
      scoreTeamTwo: 0,
      currentPeriod: dto.period as FootballPeriod,
      matchMinute: dto.matchMinute,
    };

    const doc = new this.scoringSessionModel({
      sport: SportType.FOOTBALL,
      teamMatchId,
      teamOneId,
      teamTwoId,
      status: ScoringSessionStatus.SCHEDULED,
      footballState,
    });
    return doc.save();
  }

  async appendEvent(
    userId: string,
    sessionId: string,
    dto: AppendFootballEventDto,
  ): Promise<FootballMatchEventDocument> {
    const session = await this.scoringSessionService.requireSession(sessionId);
    this.scoringSessionService.assertSport(session, SportType.FOOTBALL);
    this.scoringSessionService.assertCanAppendEvents(session);
    if (!session.footballState) {
      throw new BadRequestException('Invalid football session');
    }

    await this.assertLeadershipOnSessionTeams(userId, session);

    const fs = session.footballState;
    fs.currentPeriod = dto.period as FootballPeriod;
    if (dto.matchMinute !== undefined) {
      fs.matchMinute = dto.matchMinute;
    }

    const last = await this.footballEventModel
      .findOne({ sessionId: session._id })
      .sort({ sequence: -1 })
      .lean();
    const sequence = (last?.sequence ?? 0) + 1;

    const built = await this.buildEventFromPayload(session, dto, sequence);

    session.status = ScoringSessionStatus.LIVE;
    await Promise.all([built.save(), session.save()]);
    return built;
  }

  async getSessionView(sessionId: string): Promise<ScoringSessionDocument> {
    const session = await this.scoringSessionService.requireSession(sessionId);
    this.scoringSessionService.assertSport(session, SportType.FOOTBALL);
    return session;
  }

  async listEvents(sessionId: string, query: ListFootballEventsDto) {
    const session = await this.scoringSessionService.requireSession(sessionId);
    this.scoringSessionService.assertSport(session, SportType.FOOTBALL);
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.footballEventModel
        .find({ sessionId: session._id })
        .sort({ sequence: 1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.footballEventModel.countDocuments({ sessionId: session._id }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async getPoints(sessionId: string) {
    const session = await this.scoringSessionService.requireSession(sessionId);
    this.scoringSessionService.assertSport(session, SportType.FOOTBALL);
    const events = await this.footballEventModel
      .find({ sessionId: session._id })
      .sort({ sequence: 1 })
      .lean();
    return computeFootballPlayerPoints(events as FootballMatchEvent[]);
  }

  private scoreDeltasForBeneficiary(
    session: ScoringSessionDocument,
    beneficiaryTeamId: Types.ObjectId,
  ): { d1: number; d2: number } {
    const b = beneficiaryTeamId.toString();
    const t1 = session.teamOneId.toString();
    const t2 = session.teamTwoId.toString();
    if (b === t1) return { d1: 1, d2: 0 };
    if (b === t2) return { d1: 0, d2: 1 };
    throw new BadRequestException('beneficiaryTeamId must be a session team');
  }

  private async buildEventFromPayload(
    session: ScoringSessionDocument,
    dto: AppendFootballEventDto,
    sequence: number,
  ): Promise<FootballMatchEventDocument> {
    const p = dto.payload;
    const fs = session.footballState!;

    switch (p.kind) {
      case 'goal': {
        const ben = new Types.ObjectId(p.beneficiaryTeamId);
        const scorer = new Types.ObjectId(p.scorerUserId);
        await this.assertUserOnTeam(scorer, ben);
        if (p.assistUserId) {
          await this.assertUserOnTeam(new Types.ObjectId(p.assistUserId), ben);
        }
        const { d1, d2 } = this.scoreDeltasForBeneficiary(session, ben);
        fs.scoreTeamOne += d1;
        fs.scoreTeamTwo += d2;
        return new this.footballEventModel({
          sessionId: session._id,
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
        const concedingTeam = this.otherTeam(session, ben);
        await this.assertUserOnTeam(conceding, concedingTeam);
        const { d1, d2 } = this.scoreDeltasForBeneficiary(session, ben);
        fs.scoreTeamOne += d1;
        fs.scoreTeamTwo += d2;
        return new this.footballEventModel({
          sessionId: session._id,
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
        await this.assertUserOnTeam(player, teamId);
        return new this.footballEventModel({
          sessionId: session._id,
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
        await this.assertUserOnTeam(player, teamId);
        return new this.footballEventModel({
          sessionId: session._id,
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
        await this.assertUserOnTeam(
          new Types.ObjectId(p.playerOffUserId),
          teamId,
        );
        await this.assertUserOnTeam(
          new Types.ObjectId(p.playerOnUserId),
          teamId,
        );
        return new this.footballEventModel({
          sessionId: session._id,
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
        await this.assertUserOnTeam(taker, ben);
        const { d1, d2 } = this.scoreDeltasForBeneficiary(session, ben);
        fs.scoreTeamOne += d1;
        fs.scoreTeamTwo += d2;
        return new this.footballEventModel({
          sessionId: session._id,
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
        await this.assertUserOnTeam(taker, teamId);
        return new this.footballEventModel({
          sessionId: session._id,
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
    session: ScoringSessionDocument,
    teamId: Types.ObjectId,
  ): Types.ObjectId {
    const t = teamId.toString();
    if (t === session.teamOneId.toString()) return session.teamTwoId;
    if (t === session.teamTwoId.toString()) return session.teamOneId;
    throw new BadRequestException('Invalid team id');
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
