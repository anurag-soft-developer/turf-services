import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model } from 'mongoose';
import {
  TeamInviteDocument,
  TeamInviteStatus,
} from '../schemas/team-invite.schema';
import { resolveId } from '../../core/utils/mongo-ref.util';

export function assertInvitee(
  invite: TeamInviteDocument,
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
  invite: TeamInviteDocument,
): Promise<void> {
  if (invite.status !== TeamInviteStatus.PENDING) {
    throw new BadRequestException('Invite is not pending');
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    invite.status = TeamInviteStatus.EXPIRED;
    invite.respondedAt = new Date();
    await invite.save();
    throw new BadRequestException('This invite has expired');
  }
}

export async function requireInvite(
  teamInviteModel: Model<TeamInviteDocument>,
  inviteId: string,
  teamId: string,
): Promise<TeamInviteDocument> {
  const invite = await teamInviteModel.findById(inviteId);
  if (!invite || resolveId(invite.team) !== resolveId(teamId)) {
    throw new NotFoundException('Invite not found');
  }
  return invite;
}

export async function requireInviteById(
  teamInviteModel: Model<TeamInviteDocument>,
  inviteId: string,
): Promise<TeamInviteDocument> {
  const invite = await teamInviteModel.findById(inviteId);
  if (!invite) {
    throw new NotFoundException('Invite not found');
  }
  return invite;
}
