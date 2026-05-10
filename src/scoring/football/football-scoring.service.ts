import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertCanActForTeam } from '../../matchmaking/util/matchmaking.helpers';
import {
  FootballPeriod,
  FootballState,
  TeamMatch,
  TeamMatchDocument,
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
    @InjectModel(FootballMatchEvent.name)
    private readonly footballEventModel: Model<FootballMatchEventDocument>,
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
    private readonly realtimeDispatcher: ScoringRealtimeDispatcher,
  ) {}

  async createSession(
    userId: string,
    teamMatchId: string,
    dto: CreateFootballSessionDto,
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
    assertTeamMatchSport(match, SportType.FOOTBALL);
    ensureActorTeamOnMatch(match, new Types.ObjectId(dto.actorTeamId));
    assertCanAppendScoringEvents(match);

    if (match.footballState) {
      throw new BadRequestException('Football scoring already initialized');
    }

    const footballState: FootballState = {
      scoreTeamOne: 0,
      scoreTeamTwo: 0,
      currentPeriod: dto.period as FootballPeriod,
      matchMinute: dto.matchMinute,
    };

    match.footballState = footballState;
    return match.save();
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

    await this.assertLeadershipOnMatchTeams(userId, match);

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

  async getSessionView(teamMatchId: string): Promise<TeamMatchDocument> {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    return match;
  }

  async listEvents(teamMatchId: string, query: ListFootballEventsDto) {
    const match = await requireTeamMatchForScoring(
      this.teamMatchModel,
      teamMatchId,
    );
    assertTeamMatchSport(match, SportType.FOOTBALL);
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.footballEventModel
        .find({ teamMatchId: match._id })
        .sort({ sequence: 1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.footballEventModel.countDocuments({ teamMatchId: match._id }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
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
    return computeFootballPlayerPoints(events as FootballMatchEvent[]);
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
        await this.assertUserOnTeam(scorer, ben);
        if (p.assistUserId) {
          await this.assertUserOnTeam(new Types.ObjectId(p.assistUserId), ben);
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
        await this.assertUserOnTeam(conceding, concedingTeam);
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
        await this.assertUserOnTeam(player, teamId);
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
        await this.assertUserOnTeam(player, teamId);
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
        await this.assertUserOnTeam(
          new Types.ObjectId(p.playerOffUserId),
          teamId,
        );
        await this.assertUserOnTeam(
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
        await this.assertUserOnTeam(taker, ben);
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
        await this.assertUserOnTeam(taker, teamId);
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

  private async assertLeadershipOnMatchTeams(
    userId: string,
    match: TeamMatchDocument,
  ): Promise<void> {
    const t1 = await this.teamService.requireTeam(match.fromTeam.toString());
    const t2 = await this.teamService.requireTeam(match.toTeam.toString());
    const can1 = await this.canLeadershipAct(t1, userId);
    const can2 = await this.canLeadershipAct(t2, userId);
    if (!can1 && !can2) {
      throw new ForbiddenException(
        'Only owners, captains, or vice captains of a match team can score',
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
