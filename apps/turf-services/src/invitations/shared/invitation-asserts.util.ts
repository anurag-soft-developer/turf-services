import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InvitationKind, InvitationStatus } from '../invitation.constants';
import { InvitationDocument } from '../schemas/invitation.schema';

export function assertPending(invitation: InvitationDocument): void {
  if (invitation.status !== InvitationStatus.PENDING) {
    throw new BadRequestException('This invitation is no longer pending');
  }
}

export function assertKind(
  invitation: InvitationDocument,
  kind: InvitationKind,
): void {
  if (invitation.kind !== kind) {
    throw new BadRequestException('This invitation cannot be updated that way');
  }
}

export async function requireForTournament(
  invitationModel: Model<InvitationDocument>,
  tournamentId: Types.ObjectId,
  invitationId: string,
): Promise<InvitationDocument> {
  if (!Types.ObjectId.isValid(invitationId)) {
    throw new BadRequestException('Invalid invitation id');
  }
  const invitation = await invitationModel.findOne({
    _id: invitationId,
    kind: InvitationKind.TOURNAMENT_INVITE,
    tournament: tournamentId,
  });
  if (!invitation) {
    throw new NotFoundException('Invitation not found');
  }
  return invitation;
}

export async function assertNoLiveTournamentInvitation(
  invitationModel: Model<InvitationDocument>,
  tournamentId: Types.ObjectId,
  teamId: Types.ObjectId,
): Promise<void> {
  const live = await invitationModel.exists({
    kind: InvitationKind.TOURNAMENT_INVITE,
    tournament: tournamentId,
    team: teamId,
    status: {
      $in: [InvitationStatus.PENDING, InvitationStatus.ACCEPTED],
    },
  });
  if (live) {
    throw new ConflictException(
      'This team already has a live entry in the tournament',
    );
  }
}
