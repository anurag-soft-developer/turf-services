import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import {
  SPORT_ROSTER_CONFIG,
  SportType,
  TeamDocument,
  TeamStatus,
  TeamVisibility,
} from '../../team/schemas/team.schema';
import {
  TeamMemberDocument,
  TeamMemberStatus,
} from '../schemas/team-member.schema';

type TeamLookup = {
  requireTeam(id: string): Promise<TeamDocument>;
};

type ConnectionLookup = {
  isConnectedToAny(
    userId: string,
    otherUserIds: Types.ObjectId[],
  ): Promise<boolean>;
};

export function assertTeamRecruiting(team: { status: TeamStatus }): void {
  if (team.status !== TeamStatus.ACTIVE) {
    throw new BadRequestException('This team is not recruiting');
  }
}

export async function assertRosterHasRoom(
  teamMemberModel: Model<TeamMemberDocument>,
  teamId: string,
  team: { sportType: string },
): Promise<void> {
  const config = SPORT_ROSTER_CONFIG[team.sportType as SportType];
  const max = config?.max ?? 500;
  const n = await teamMemberModel.countDocuments({
    team: new Types.ObjectId(teamId),
    status: TeamMemberStatus.ACTIVE,
  });
  if (n >= max) {
    throw new ConflictException('Team roster is full');
  }
}

export async function assertNoOpenStint(
  teamMemberModel: Model<TeamMemberDocument>,
  teamId: string,
  userId: string,
): Promise<void> {
  const existing = await teamMemberModel.findOne({
    team: new Types.ObjectId(teamId),
    user: new Types.ObjectId(userId),
    status: {
      $in: [
        TeamMemberStatus.PENDING,
        TeamMemberStatus.ACTIVE,
        TeamMemberStatus.SUSPENDED,
      ],
    },
  });
  if (existing) {
    throw new ConflictException('Already joined');
  }
}

export async function assertCanRequestJoin(
  teamService: TeamLookup,
  followingsService: ConnectionLookup,
  teamMemberModel: Model<TeamMemberDocument>,
  teamId: string,
  userId: string,
  opening: { maxPendingJoinRequests?: number },
  pendingCount: number,
): Promise<{ team: TeamDocument }> {
  const team = await teamService.requireTeam(teamId);
  assertTeamRecruiting(team);
  await assertNoOpenStint(teamMemberModel, teamId, userId);

  if (team.visibility === TeamVisibility.PRIVATE) {
    const allowed = await followingsService.isConnectedToAny(
      userId,
      team.ownerIds,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Only users connected to an owner can join private teams',
      );
    }
  }

  if (pendingCount >= (opening.maxPendingJoinRequests ?? 50)) {
    throw new ConflictException(
      'This team is not accepting more join requests',
    );
  }
  return { team };
}
