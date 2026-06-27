import { Model } from 'mongoose';
import { UserRole } from '../../auth/decorators/roles.decorator';
import {
  LeadershipRole,
  TeamMember,
  TeamMemberStatus,
} from '../../team-member/schemas/team-member.schema';
import type { TeamDocument } from '../../team/schemas/team.schema';
import { User } from '../../users/schemas/user.schema';
import type {
  CreateNotificationInput,
  NotificationBaseDto,
} from '../dto/notification.dto';
import { NotificationService } from '../notification.service';

export type { NotificationBaseDto };

/**
 * Fan-out a notification to multiple users (deduped). Optionally excludes the actor.
 */
export async function dispatchToUsers<T extends NotificationBaseDto>(
  notificationService: NotificationService,
  recipientUserIds: string[],
  baseDto: T,
  excludeUserId?: string,
): Promise<void> {
  const unique = [
    ...new Set(
      recipientUserIds.map((id) => id.trim()).filter((id) => id.length > 0),
    ),
  ].filter((id) => id !== excludeUserId);

  await Promise.all(
    unique.map((recipientUserId) =>
      notificationService.createAndDispatch({
        ...baseDto,
        recipientUserId,
      } as CreateNotificationInput),
    ),
  );
}

/**
 * Owners plus active captains and vice-captains — same set as matchmaking auth.
 */
export async function getTeamStaffUserIds(
  teamMemberModel: Model<TeamMember>,
  team: TeamDocument,
): Promise<string[]> {
  const ownerIds = team.ownerIds.map((id) => id.toString());
  const leadershipUserIds = await teamMemberModel.distinct('user', {
    team: team._id,
    status: TeamMemberStatus.ACTIVE,
    leadershipRole: {
      $in: [LeadershipRole.CAPTAIN, LeadershipRole.VICE_CAPTAIN],
    },
  });
  return [
    ...new Set([...ownerIds, ...leadershipUserIds.map((id) => id.toString())]),
  ];
}

export async function getPlatformAdminUserIds(
  userModel: Model<User>,
): Promise<string[]> {
  const ids = await userModel.distinct('_id', {
    role: { $in: [UserRole.ADMIN, UserRole.PLATFORM_ADMIN] },
  });
  return ids.map((id) => id.toString());
}
