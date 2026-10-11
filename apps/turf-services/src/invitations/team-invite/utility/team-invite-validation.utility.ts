import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model } from 'mongoose';
import { InvitationKind, InvitationStatus } from '../../invitation.constants';
import { InvitationDocument } from '../../schemas/invitation.schema';
import { resolveId } from '../../../core/utils/mongo-ref.util';

export function assertInvitee(
  invite: InvitationDocument,
  userId: string,
): void {
  if (
    !invite.inviteeUser ||
    resolveId(invite.inviteeUser) !== resolveId(userId)
  ) {
    throw new ForbiddenException('This invite is not for you');
  }
}

export async function ensurePendingNotExpired(
  invite: InvitationDocument,
): Promise<void> {
  if (invite.status !== InvitationStatus.PENDING) {
    throw new BadRequestException('Invite is not pending');
  }
  if (!invite.expiresAt || invite.expiresAt.getTime() <= Date.now()) {
    invite.status = InvitationStatus.EXPIRED;
    invite.decidedAt = new Date();
    await invite.save();
    throw new BadRequestException('This invite has expired');
  }
}

export async function requireTeamInvite(
  invitationModel: Model<InvitationDocument>,
  invitationId: string,
  teamId?: string,
): Promise<InvitationDocument> {
  const invite = await invitationModel.findById(invitationId).exec();
  if (!invite || invite.kind !== InvitationKind.TEAM_INVITE) {
    throw new NotFoundException('Invite not found');
  }
  if (teamId != null && resolveId(invite.team) !== resolveId(teamId)) {
    throw new NotFoundException('Invite not found');
  }
  return invite;
}
