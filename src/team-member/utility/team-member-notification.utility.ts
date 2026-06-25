import { Logger } from '@nestjs/common';
import { dispatchToUsers } from '../../notification/utility/notification-dispatch.utility';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';

const logger = new Logger('TeamMemberNotification');

export async function notifyTeamJoinRequest(
  notificationService: NotificationService,
  team: TeamDocument,
  membershipId: string,
  requesterUserId: string,
): Promise<void> {
  try {
    await dispatchToUsers(
      notificationService,
      team.ownerIds.map((id) => id.toString()),
      {
        module: NotificationModule.TEAMS,
        title: 'Join request',
        body: `Someone requested to join ${team.name}.`,
        data: {
          kind: 'team_join_request',
          teamId: team._id.toString(),
          membershipId,
          actorUserId: requesterUserId,
        },
        sourceType: 'teamMember',
        sourceId: membershipId,
      },
      requesterUserId,
    );
  } catch (err) {
    logger.warn(
      `notifyTeamJoinRequest failed for team ${team._id.toString()}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyTeamJoinResolved(
  notificationService: NotificationService,
  params: {
    recipientUserId: string;
    teamId: string;
    teamName: string;
    membershipId: string;
    accepted: boolean;
  },
): Promise<void> {
  try {
    await notificationService.createAndDispatch({
      recipientUserId: params.recipientUserId,
      module: NotificationModule.TEAMS,
      title: params.accepted ? 'Join request accepted' : 'Join request rejected',
      body: params.accepted
        ? `You were accepted into ${params.teamName}.`
        : `Your request to join ${params.teamName} was rejected.`,
      data: {
        kind: params.accepted ? 'team_join_accepted' : 'team_join_rejected',
        teamId: params.teamId,
        membershipId: params.membershipId,
      },
      sourceType: 'teamMember',
      sourceId: params.membershipId,
    });
  } catch (err) {
    logger.warn(
      `notifyTeamJoinResolved failed for membership ${params.membershipId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
