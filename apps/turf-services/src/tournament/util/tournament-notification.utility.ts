import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { dispatchToUsers } from '../../notification/utility/notification-dispatch.utility';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import type { MatchmakingNotificationData } from '../../notification/types/notification-data.types';
import { TeamMember } from '../../team-member/schemas/team-member.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';
import { getTeamStaffUserIds } from '../../notification/utility/notification-dispatch.utility';

const logger = new Logger('TournamentNotification');

type TournamentNotice = {
  recipientUserIds: string[];
  excludeUserId?: string;
  title: string;
  body: string;
  data: MatchmakingNotificationData;
  sourceId: string;
};

async function send(notificationService: NotificationService, notice: TournamentNotice) {
  try {
    await dispatchToUsers(
      notificationService,
      notice.recipientUserIds,
      {
        module: NotificationModule.MATCHMAKING,
        title: notice.title,
        body: notice.body,
        data: notice.data,
        sourceType: 'tournament',
        sourceId: notice.sourceId,
      },
      notice.excludeUserId,
    );
  } catch (err) {
    logger.warn(
      `tournament notification failed for ${notice.sourceId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

export async function notifyTournamentInvite(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  params: {
    team: TeamDocument;
    tournamentId: string;
    tournamentName: string;
    invitationId: string;
    actorUserId: string;
  },
): Promise<void> {
  const recipientUserIds = await getTeamStaffUserIds(
    teamMemberModel,
    params.team,
  );
  await send(notificationService, {
    recipientUserIds,
    excludeUserId: params.actorUserId,
    title: 'Tournament invite',
    body: `Your team was invited to ${params.tournamentName}.`,
    data: {
      kind: 'tournament_invite',
      tournamentId: params.tournamentId,
      invitationId: params.invitationId,
    },
    sourceId: params.tournamentId,
  });
}

export async function notifyTournamentRequest(
  notificationService: NotificationService,
  params: {
    organizerUserIds: string[];
    teamName: string;
    tournamentId: string;
    tournamentName: string;
    invitationId: string;
    actorUserId: string;
  },
): Promise<void> {
  await send(notificationService, {
    recipientUserIds: params.organizerUserIds,
    excludeUserId: params.actorUserId,
    title: 'Tournament request',
    body: `${params.teamName} asked to join ${params.tournamentName}.`,
    data: {
      kind: 'tournament_request',
      tournamentId: params.tournamentId,
      invitationId: params.invitationId,
    },
    sourceId: params.tournamentId,
  });
}

export async function notifyEntryDecision(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  params: {
    kind: Extract<
      MatchmakingNotificationData,
      | { kind: 'tournament_invite_accepted' }
      | { kind: 'tournament_invite_declined' }
      | { kind: 'tournament_request_accepted' }
      | { kind: 'tournament_request_declined' }
      | { kind: 'tournament_request_withdrawn' }
    >['kind'];
    title: string;
    body: string;
    tournamentId: string;
    invitationId: string;
    actorUserId: string;
    organizerUserIds?: string[];
    team?: TeamDocument;
  },
): Promise<void> {
  const recipientUserIds = params.team
    ? await getTeamStaffUserIds(teamMemberModel, params.team)
    : (params.organizerUserIds ?? []);
  await send(notificationService, {
    recipientUserIds,
    excludeUserId: params.actorUserId,
    title: params.title,
    body: params.body,
    data: {
      kind: params.kind,
      tournamentId: params.tournamentId,
      invitationId: params.invitationId,
    },
    sourceId: params.tournamentId,
  });
}
