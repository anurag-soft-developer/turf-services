import { Logger } from '@nestjs/common';
import { dispatchToUsers } from '../../notification/utility/notification-dispatch.utility';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';
import { EmailService } from '../../core/services/email.service';
import { SmsService } from '../../core/services/sms.service';

const logger = new Logger('TeamInviteNotification');

export async function notifyTeamInvite(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    team: TeamDocument;
    inviteId: string;
    actorUserId: string;
  },
): Promise<void> {
  try {
    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.TEAMS,
      title: 'Team invitation',
      body: `You were invited to join ${params.team.name}.`,
      data: {
        kind: 'team_invite',
        teamId: params.team._id.toString(),
        inviteId: params.inviteId,
        actorUserId: params.actorUserId,
      },
      sourceType: 'teamInvite',
      sourceId: params.inviteId,
    });
  } catch (err) {
    logger.warn(
      `notifyTeamInvite failed for invite ${params.inviteId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyTeamInviteAccepted(
  notificationService: NotificationService,
  team: TeamDocument,
  inviteId: string,
  inviteeUserId: string,
): Promise<void> {
  try {
    await dispatchToUsers(
      notificationService,
      team.ownerIds.map((id) => id.toString()),
      {
        module: NotificationModule.TEAMS,
        title: 'Invite accepted',
        body: `Someone accepted your invitation to ${team.name}.`,
        data: {
          kind: 'team_invite_accepted',
          teamId: team._id.toString(),
          inviteId,
          actorUserId: inviteeUserId,
        },
        sourceType: 'teamInvite',
        sourceId: inviteId,
      },
      inviteeUserId,
    );
  } catch (err) {
    logger.warn(
      `notifyTeamInviteAccepted failed for invite ${inviteId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyTeamInviteRejected(
  notificationService: NotificationService,
  team: TeamDocument,
  inviteId: string,
  inviteeUserId: string,
): Promise<void> {
  try {
    await dispatchToUsers(
      notificationService,
      team.ownerIds.map((id) => id.toString()),
      {
        module: NotificationModule.TEAMS,
        title: 'Invite rejected',
        body: `Someone declined your invitation to ${team.name}.`,
        data: {
          kind: 'team_invite_rejected',
          teamId: team._id.toString(),
          inviteId,
          actorUserId: inviteeUserId,
        },
        sourceType: 'teamInvite',
        sourceId: inviteId,
      },
      inviteeUserId,
    );
  } catch (err) {
    logger.warn(
      `notifyTeamInviteRejected failed for invite ${inviteId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function sendOutboundInvite(
  emailService: EmailService,
  smsService: SmsService,
  params: {
    email?: string;
    phone?: string;
    teamName: string;
    inviterName: string;
    inviteeName?: string;
  },
): Promise<void> {
  try {
    if (params.email) {
      await emailService.sendTeamInviteEmail({
        to: params.email,
        inviteeName: params.inviteeName,
        inviterName: params.inviterName,
        teamName: params.teamName,
      });
    } else if (params.phone) {
      await smsService.sendTeamInviteSms({
        to: params.phone,
        inviterName: params.inviterName,
        teamName: params.teamName,
      });
    }
  } catch (err) {
    logger.warn(
      'Outbound invite message failed',
      err instanceof Error ? err.stack : String(err),
    );
  }
}
