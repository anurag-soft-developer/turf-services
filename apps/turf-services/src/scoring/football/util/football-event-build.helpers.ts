import { BadRequestException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { TeamMatchDocument } from '../../../matchmaking/schemas/team-match.schema';
import { resolveId } from '../../../core/utils/mongo-ref.util';
import { assertAnnouncedPlayingParticipant } from '../../common/scoring-participant.asserts';
import { applySubstitution, removeFromActiveLineup } from '../../common/lineup.helpers';
import {
  FootballEventKind,
  FootballMatchEventDocument,
} from '../football-match-event.schema';
import { AppendFootballEventDto } from '../dto/football-scoring.dto';
import {
  applyFootballScoreDeltas,
  getCurrentInningsSummary,
} from './football-innings.helpers';

function scoreDeltasForBeneficiary(
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

function otherTeam(
  match: TeamMatchDocument,
  teamId: Types.ObjectId,
): Types.ObjectId {
  if (resolveId(teamId) === resolveId(match.fromTeam)) return match.toTeam;
  if (resolveId(teamId) === resolveId(match.toTeam)) return match.fromTeam;
  throw new BadRequestException('Invalid team id');
}

export function buildFootballEventFromPayload(
  footballEventModel: Model<FootballMatchEventDocument>,
  match: TeamMatchDocument,
  dto: AppendFootballEventDto,
  sequence: number,
): FootballMatchEventDocument {
  const p = dto.payload;
  const fs = match.footballState!;
  const innings = fs.currentInnings;
  const inningSummary = getCurrentInningsSummary(fs);
  if (!inningSummary.period) {
    inningSummary.period = fs.currentPeriod;
  }

  const base = {
    teamMatchId: match._id,
    sequence,
    innings,
    period: fs.currentPeriod,
    matchMinute: fs.matchMinute,
  };

  switch (p.kind) {
    case 'goal': {
      const ben = new Types.ObjectId(p.beneficiaryTeamId);
      const scorer = new Types.ObjectId(p.scorerUserId);
      assertAnnouncedPlayingParticipant(match, ben, scorer, 'Scorer');
      if (p.assistUserId) {
        assertAnnouncedPlayingParticipant(
          match,
          ben,
          new Types.ObjectId(p.assistUserId),
          'Assist',
        );
      }
      const { d1, d2 } = scoreDeltasForBeneficiary(match, ben);
      applyFootballScoreDeltas(fs, d1, d2);
      return new footballEventModel({
        ...base,
        kind: FootballEventKind.GOAL,
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
      const concedingTeam = otherTeam(match, ben);
      assertAnnouncedPlayingParticipant(
        match,
        concedingTeam,
        conceding,
        'Conceding player',
      );
      const { d1, d2 } = scoreDeltasForBeneficiary(match, ben);
      applyFootballScoreDeltas(fs, d1, d2);
      return new footballEventModel({
        ...base,
        kind: FootballEventKind.OWN_GOAL,
        beneficiaryTeamId: ben,
        primaryUserId: conceding,
        scoreDeltaTeamOne: d1,
        scoreDeltaTeamTwo: d2,
      });
    }
    case 'yellow_card': {
      const teamId = new Types.ObjectId(p.teamId);
      const player = new Types.ObjectId(p.playerUserId);
      assertAnnouncedPlayingParticipant(match, teamId, player, 'Player');
      return new footballEventModel({
        ...base,
        kind: FootballEventKind.YELLOW_CARD,
        beneficiaryTeamId: teamId,
        primaryUserId: player,
        scoreDeltaTeamOne: 0,
        scoreDeltaTeamTwo: 0,
      });
    }
    case 'red_card': {
      const teamId = new Types.ObjectId(p.teamId);
      const player = new Types.ObjectId(p.playerUserId);
      assertAnnouncedPlayingParticipant(match, teamId, player, 'Player');
      removeFromActiveLineup(match, fs, teamId, player);
      return new footballEventModel({
        ...base,
        kind: FootballEventKind.RED_CARD,
        beneficiaryTeamId: teamId,
        primaryUserId: player,
        scoreDeltaTeamOne: 0,
        scoreDeltaTeamTwo: 0,
      });
    }
    case 'substitution': {
      const teamId = new Types.ObjectId(p.teamId);
      const playerOff = new Types.ObjectId(p.playerOffUserId);
      const playerOn = new Types.ObjectId(p.playerOnUserId);
      applySubstitution(
        match,
        match.footballState!,
        teamId,
        playerOff,
        playerOn,
      );
      return new footballEventModel({
        ...base,
        kind: FootballEventKind.SUBSTITUTION,
        beneficiaryTeamId: teamId,
        primaryUserId: playerOff,
        secondaryUserId: playerOn,
        scoreDeltaTeamOne: 0,
        scoreDeltaTeamTwo: 0,
      });
    }
    case 'penalty_scored': {
      const ben = new Types.ObjectId(p.beneficiaryTeamId);
      const taker = new Types.ObjectId(p.takerUserId);
      assertAnnouncedPlayingParticipant(match, ben, taker, 'Taker');
      const { d1, d2 } = scoreDeltasForBeneficiary(match, ben);
      applyFootballScoreDeltas(fs, d1, d2);
      return new footballEventModel({
        ...base,
        kind: FootballEventKind.PENALTY_SCORED,
        beneficiaryTeamId: ben,
        primaryUserId: taker,
        scoreDeltaTeamOne: d1,
        scoreDeltaTeamTwo: d2,
      });
    }
    case 'penalty_missed': {
      const teamId = new Types.ObjectId(p.teamId);
      const taker = new Types.ObjectId(p.takerUserId);
      assertAnnouncedPlayingParticipant(match, teamId, taker, 'Taker');
      return new footballEventModel({
        ...base,
        kind: FootballEventKind.PENALTY_MISSED,
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
