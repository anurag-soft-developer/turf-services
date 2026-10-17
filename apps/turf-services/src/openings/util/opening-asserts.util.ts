import { BadRequestException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { SportType } from '../../core/sports/sport-types';
import { TeamService } from '../../team/team.service';
import { TournamentDocument } from '../../tournament/schemas/tournament.schema';
import {
  assertOrganizer,
  requireTournament,
} from '../../tournament/util/tournament-asserts.util';
import {
  OpeningType,
} from '../schemas/opening.schema';
import {
  HostSnapshot,
  teamSnapshot,
  tournamentSnapshot,
} from './opening-host.util';

export function assertObjectId(id: string, label: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestException(`Invalid ${label} id`);
  }
}

export function hostId(opening: {
  type: OpeningType;
  teamId?: Types.ObjectId;
  tournamentId?: Types.ObjectId;
}): string {
  const id =
    opening.type === OpeningType.TEAM ? opening.teamId : opening.tournamentId;
  if (!id) {
    throw new BadRequestException('Opening is missing its host');
  }
  return id.toString();
}

export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  );
}

export async function assertCanManage(
  teamService: TeamService,
  tournamentModel: Model<TournamentDocument>,
  userId: string,
  type: OpeningType,
  targetId: string,
): Promise<{ sportType: SportType; snapshot: HostSnapshot }> {
  if (type === OpeningType.TEAM) {
    const team = await teamService.requireTeam(targetId);
    teamService.assertOwner(team, userId);
    return {
      sportType: team.sportType,
      snapshot: teamSnapshot(team),
    };
  }

  const tournament = await requireTournament(tournamentModel, targetId);
  assertOrganizer(tournament, userId);
  return {
    sportType: tournament.sportType,
    snapshot: tournamentSnapshot(tournament),
  };
}

export async function assertCanPost(
  teamService: TeamService,
  tournamentModel: Model<TournamentDocument>,
  userId: string,
  type: OpeningType,
  targetId: string,
): Promise<{ sportType: SportType; snapshot: HostSnapshot }> {
  return assertCanManage(
    teamService,
    tournamentModel,
    userId,
    type,
    targetId,
  );
}
