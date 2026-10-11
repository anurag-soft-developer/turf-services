import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { resolveId, type MongoRefLike } from '../../core/utils/mongo-ref.util';
import { assertTeamEligibleForMatching } from '../../matchmaking/util/matchmaking.helpers';
import { SportType, TeamDocument } from '../../team/schemas/team.schema';
import { TeamService } from '../../team/team.service';
import {
  InvitationKind,
  InvitationStatus,
} from '../../invitations/invitation.constants';
import { InvitationDocument } from '../../invitations/schemas/invitation.schema';
import { TournamentDocument } from '../schemas/tournament.schema';
import { TournamentStatus } from '../tournament.constants';
import { isTournamentRosterLocked } from './tournament-entry.util';

export async function assertJoinOpen(
  invitationModel: Model<InvitationDocument>,
  tournament: TournamentDocument,
): Promise<void> {
  if (tournament.status !== TournamentStatus.INVITING) {
    throw new BadRequestException('This tournament is not taking teams');
  }
  if (
    tournament.registrationDeadline &&
    Date.now() > tournament.registrationDeadline.getTime()
  ) {
    throw new BadRequestException('Registration for this tournament has closed');
  }
  if (isTournamentRosterLocked(tournament)) {
    throw new BadRequestException('The roster is locked');
  }
  if (tournament.maxTeams == null) {
    return;
  }
  const accepted = await invitationModel.countDocuments({
    kind: InvitationKind.TOURNAMENT_INVITE,
    tournament: tournament._id,
    status: InvitationStatus.ACCEPTED,
  });
  if (accepted >= tournament.maxTeams) {
    throw new BadRequestException('This tournament is full');
  }
}

export async function requireCricketTeam(
  teamService: TeamService,
  teamId: string,
  sportType: SportType = SportType.CRICKET,
): Promise<TeamDocument> {
  const team = await teamService.requireTeam(teamId);
  if (team.sportType !== sportType) {
    throw new BadRequestException(
      `Only ${sportType.replace('_', ' ')} teams can enter`,
    );
  }
  assertTeamEligibleForMatching(team);
  return team;
}

export async function requireTournament(
  tournamentModel: Model<TournamentDocument>,
  id: string,
): Promise<TournamentDocument> {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestException('Invalid tournament id');
  }
  const tournament = await tournamentModel.findById(id);
  if (!tournament) {
    throw new NotFoundException('Tournament not found');
  }
  return tournament;
}

type OrganizerSource = {
  organizerUserId: MongoRefLike;
  organizerIds?: MongoRefLike[];
};

/** Membership list used for auth. Empty `organizerIds` falls back to the creator. */
export function organizerIdList(tournament: OrganizerSource): string[] {
  const ids = (tournament.organizerIds ?? [])
    .map((id) => resolveId(id))
    .filter((id) => id.length > 0);
  if (ids.length > 0) {
    return ids;
  }
  const creator = resolveId(tournament.organizerUserId);
  return creator ? [creator] : [];
}

export function isOrganizer(tournament: OrganizerSource, userId: string): boolean {
  return organizerIdList(tournament).includes(resolveId(userId));
}

export function assertOrganizer(tournament: OrganizerSource, userId: string): void {
  if (!isOrganizer(tournament, userId)) {
    throw new ForbiddenException('Only the organizer can do that');
  }
}

export async function requireOrganizer(
  tournamentModel: Model<TournamentDocument>,
  id: string,
  userId: string,
): Promise<TournamentDocument> {
  const tournament = await requireTournament(tournamentModel, id);
  assertOrganizer(tournament, userId);
  return tournament;
}

