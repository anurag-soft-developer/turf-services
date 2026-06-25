import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import {
  dispatchToUsers,
  getTeamStaffUserIds,
  type NotificationBaseDto,
} from '../../notification/utility/notification-dispatch.utility';
import { NotificationService } from '../../notification/notification.service';
import { NotificationModule } from '../../notification/schemas/notification.schema';
import {
  TeamMember,
} from '../../team-member/schemas/team-member.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';
import { TeamService } from '../../team/team.service';
import type { TeamMatchDocument } from '../schemas/team-match.schema';

const logger = new Logger('MatchmakingNotification');

function matchBase(matchId: string): Pick<NotificationBaseDto, 'module' | 'sourceType' | 'sourceId'> {
  return {
    module: NotificationModule.MATCHMAKING,
    sourceType: 'teamMatch',
    sourceId: matchId,
  };
}

function opponentTeamId(
  match: TeamMatchDocument,
  actorTeamId: string,
): string {
  return match.fromTeam.toString() === actorTeamId
    ? match.toTeam.toString()
    : match.fromTeam.toString();
}

async function notifyTeamsStaff(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  teamIds: string[],
  excludeUserId: string | undefined,
  payload: NotificationBaseDto,
): Promise<void> {
  try {
    const recipientIds: string[] = [];
    for (const teamId of teamIds) {
      const team = await teamService.requireTeam(teamId);
      const staffIds = await getTeamStaffUserIds(teamMemberModel, team);
      recipientIds.push(...staffIds);
    }
    await dispatchToUsers(
      notificationService,
      recipientIds,
      payload,
      excludeUserId,
    );
  } catch (err) {
    logger.warn(
      `notifyTeamsStaff failed for match ${payload.sourceId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}

async function teamDisplayName(
  teamService: TeamService,
  teamId: string,
): Promise<string> {
  const team = await teamService.requireTeam(teamId);
  return team.name;
}

export async function notifyMatchRequestReceived(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  match: TeamMatchDocument,
  fromTeam: TeamDocument,
  actorUserId: string,
): Promise<void> {
  const matchId = match._id.toString();
  await notifyTeamsStaff(
    notificationService,
    teamMemberModel,
    teamService,
    [match.toTeam.toString()],
    actorUserId,
    {
      ...matchBase(matchId),
      title: 'New match request',
      body: `${fromTeam.name} sent you a match request.`,
      data: { matchId, kind: 'match_request_received' },
    },
  );
}

export async function notifyMatchRequestResponded(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  match: TeamMatchDocument,
  toTeam: TeamDocument,
  accepted: boolean,
  actorUserId: string,
): Promise<void> {
  const matchId = match._id.toString();
  await notifyTeamsStaff(
    notificationService,
    teamMemberModel,
    teamService,
    [match.fromTeam.toString()],
    actorUserId,
    {
      ...matchBase(matchId),
      title: accepted ? 'Match request accepted' : 'Match request rejected',
      body: accepted
        ? `${toTeam.name} accepted your match request.`
        : `${toTeam.name} rejected your match request.`,
      data: {
        matchId,
        kind: accepted ? 'match_request_accepted' : 'match_request_rejected',
      },
    },
  );
}

export async function notifyMatchScheduleProposed(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  match: TeamMatchDocument,
  actorTeamId: string,
  actorUserId: string,
): Promise<void> {
  const matchId = match._id.toString();
  const actorName = await teamDisplayName(teamService, actorTeamId);
  await notifyTeamsStaff(
    notificationService,
    teamMemberModel,
    teamService,
    [opponentTeamId(match, actorTeamId)],
    actorUserId,
    {
      ...matchBase(matchId),
      title: 'Schedule proposed',
      body: `${actorName} proposed new slot or turf options.`,
      data: { matchId, kind: 'match_schedule_proposed' },
    },
  );
}

export async function notifyMatchSlotDecided(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  match: TeamMatchDocument,
  proposingTeamId: string,
  accepted: boolean,
  actorUserId: string,
): Promise<void> {
  const matchId = match._id.toString();
  await notifyTeamsStaff(
    notificationService,
    teamMemberModel,
    teamService,
    [proposingTeamId],
    actorUserId,
    {
      ...matchBase(matchId),
      title: accepted ? 'Slot proposal accepted' : 'Slot proposal rejected',
      body: accepted
        ? 'Your proposed time slot was accepted.'
        : 'Your proposed time slot was rejected.',
      data: { matchId, kind: 'match_slot_decided', accepted },
    },
  );
}

export async function notifyMatchTurfDecided(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  match: TeamMatchDocument,
  proposingTeamId: string,
  accepted: boolean,
  actorUserId: string,
): Promise<void> {
  const matchId = match._id.toString();
  await notifyTeamsStaff(
    notificationService,
    teamMemberModel,
    teamService,
    [proposingTeamId],
    actorUserId,
    {
      ...matchBase(matchId),
      title: accepted ? 'Turf proposal accepted' : 'Turf proposal rejected',
      body: accepted
        ? 'Your proposed turf was accepted.'
        : 'Your proposed turf was rejected.',
      data: { matchId, kind: 'match_turf_decided', accepted },
    },
  );
}

export async function notifyMatchScheduleFinalized(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  match: TeamMatchDocument,
  actorUserId: string,
): Promise<void> {
  const matchId = match._id.toString();
  await notifyTeamsStaff(
    notificationService,
    teamMemberModel,
    teamService,
    [match.fromTeam.toString(), match.toTeam.toString()],
    actorUserId,
    {
      ...matchBase(matchId),
      title: 'Match scheduled',
      body: 'Your match schedule has been finalized.',
      data: { matchId, kind: 'match_schedule_finalized' },
    },
  );
}

export async function notifyMatchCancelled(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  match: TeamMatchDocument,
  actorTeamId: string,
  actorUserId: string,
): Promise<void> {
  const matchId = match._id.toString();
  const actorName = await teamDisplayName(teamService, actorTeamId);
  await notifyTeamsStaff(
    notificationService,
    teamMemberModel,
    teamService,
    [opponentTeamId(match, actorTeamId)],
    actorUserId,
    {
      ...matchBase(matchId),
      title: 'Match cancelled',
      body: `${actorName} cancelled the match negotiation.`,
      data: { matchId, kind: 'match_cancelled' },
    },
  );
}

export async function notifyMatchResultRecorded(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  match: TeamMatchDocument,
  actorUserId: string,
): Promise<void> {
  const matchId = match._id.toString();
  await notifyTeamsStaff(
    notificationService,
    teamMemberModel,
    teamService,
    [match.fromTeam.toString(), match.toTeam.toString()],
    actorUserId,
    {
      ...matchBase(matchId),
      title: 'Match result recorded',
      body: 'A match result was recorded for your fixture.',
      data: { matchId, kind: 'match_result_recorded', status: match.status },
    },
  );
}

export async function notifyMatchUpdated(
  notificationService: NotificationService,
  teamMemberModel: Model<TeamMember>,
  teamService: TeamService,
  match: TeamMatchDocument,
  actorTeamId: string,
  actorUserId: string,
  finalized: boolean,
  bothTeams = false,
): Promise<void> {
  const matchId = match._id.toString();
  const teamIds =
    finalized || bothTeams
      ? [match.fromTeam.toString(), match.toTeam.toString()]
      : [opponentTeamId(match, actorTeamId)];
  await notifyTeamsStaff(
    notificationService,
    teamMemberModel,
    teamService,
    teamIds,
    actorUserId,
    {
      ...matchBase(matchId),
      title: finalized ? 'Match scheduled' : 'Match updated',
      body: finalized
        ? 'Your match schedule has been finalized.'
        : 'Your match negotiation was updated.',
      data: {
        matchId,
        kind: finalized ? 'match_schedule_finalized' : 'match_updated',
      },
    },
  );
}

export async function notifyAnnouncedPlayers(
  notificationService: NotificationService,
  params: {
    userIds: string[];
    matchId: string;
    added: boolean;
    excludeUserId?: string;
  },
): Promise<void> {
  try {
    await dispatchToUsers(
      notificationService,
      params.userIds,
      {
        ...matchBase(params.matchId),
        title: params.added ? 'Added to match squad' : 'Removed from match squad',
        body: params.added
          ? 'You were added to the announced squad for an upcoming match.'
          : 'You were removed from the announced squad for a match.',
        data: {
          matchId: params.matchId,
          kind: params.added
            ? 'announced_player_added'
            : 'announced_player_removed',
        },
      },
      params.excludeUserId,
    );
  } catch (err) {
    logger.warn(
      `notifyAnnouncedPlayers failed for match ${params.matchId}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
