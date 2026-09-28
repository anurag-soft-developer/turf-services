import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { resolveId } from '../../core/utils/mongo-ref.util';
import { ScoringRealtimeDispatcher } from '../../scoring/common/scoring-realtime-dispatcher.service';
import { TeamMember } from '../../team-member/schemas/team-member.schema';
import { TeamMemberService } from '../../team-member/team-member.service';
import { SportType } from '../../team/schemas/team.schema';
import { TeamService } from '../../team/team.service';
import { NotificationService } from '../../notification/notification.service';
import { UsersService } from '../../users/users.service';
import { announcedUserId } from '../announcedPlayers/announced-player.identity';
import {
  AnnouncedPlayer,
  AnnouncedPlayerRole,
  TeamMatch,
  TeamMatchDocument,
} from '../schemas/team-match.schema';
import {
  assertCanActForTeam,
  assertMatchAllowsAnnouncedPlayerEdits,
  assertUnranked,
  ensureMatchHasTeam,
  requireTeamMatch,
} from '../util/matchmaking.helpers';
import { notifyGuestJoin } from '../util/matchmaking-notification.utility';
import {
  assertAnnouncedPlayerRoleMatchesSport,
  defaultAnnouncedPlayerRoleForSport,
} from '../announcedPlayers/announced-player.roles';
import { GuestJoinDto, UpdateGuestJoinSettingsDto } from './dto/guest-join.dto';
import {
  buildGuestJoinState,
  countForTeam,
  openTeamIds,
  plainEntry,
  resolveTargetTeam,
  settingsOf,
  type GuestJoinState,
} from './guest-join.utility';

@Injectable()
export class GuestJoinService {
  constructor(
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMember>,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
    private readonly usersService: UsersService,
    private readonly notificationService: NotificationService,
    private readonly realtimeDispatcher: ScoringRealtimeDispatcher,
  ) {}

  async updateSettings(
    matchId: string,
    userId: string,
    dto: UpdateGuestJoinSettingsDto,
  ): Promise<GuestJoinState> {
    const match = await this.requireOpenUnrankedMatch(matchId);

    const actorTeam = await this.teamService.requireTeam(dto.actorTeamId);
    ensureMatchHasTeam(match, actorTeam._id);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );

    const settings = settingsOf(match);
    if (resolveId(actorTeam._id) === resolveId(match.fromTeam)) {
      settings.fromTeamOpen = dto.open;
    } else {
      settings.toTeamOpen = dto.open;
    }

    if (dto.maxPerTeam !== undefined) {
      const highest = Math.max(
        countForTeam(match, match.fromTeam),
        countForTeam(match, match.toTeam),
      );
      if (dto.maxPerTeam !== 0 && dto.maxPerTeam < highest) {
        throw new BadRequestException(
          `maxPerTeam cannot be below the current squad size (${highest})`,
        );
      }
      settings.maxPerTeam = dto.maxPerTeam;
    }

    match.guestJoin = settings;
    match.markModified('guestJoin');
    await match.save();
    return buildGuestJoinState(match, userId);
  }

  async join(
    matchId: string,
    userId: string,
    dto: GuestJoinDto,
  ): Promise<GuestJoinState> {
    const match = await this.requireOpenUnrankedMatch(matchId);

    const availableTeamIds = openTeamIds(match);
    if (!availableTeamIds.length) {
      throw new BadRequestException('This match is not open for guest players');
    }

    const current = (match.announcedPlayers ?? []).find(
      (player) => player.isGuest && announcedUserId(player) === userId,
    );
    const targetId = resolveTargetTeam(match, dto.teamId, availableTeamIds);

    if (current && resolveId(current.teamId) === targetId) {
      return buildGuestJoinState(match, userId);
    }
    if (!current) {
      await this.assertEligibleOutsider(match, userId);
    }

    const role = dto.role as AnnouncedPlayerRole | undefined;
    if (role !== undefined) {
      assertAnnouncedPlayerRoleMatchesSport(match.sportType, role);
    } else if (current) {
      assertAnnouncedPlayerRoleMatchesSport(match.sportType, current.role);
    }

    const entry = current
      ? {
          ...plainEntry(current),
          role: role ?? current.role,
          teamId: new Types.ObjectId(targetId),
        }
      : await this.buildGuestEntry(userId, targetId, role, match.sportType);

    if (current) {
      await this.teamMatchModel.bulkWrite([
        {
          updateOne: {
            filter: { _id: match._id },
            update: {
              $pull: {
                announcedPlayers: {
                  userId: new Types.ObjectId(userId),
                  isGuest: true,
                },
              },
            },
          },
        },
        {
          updateOne: {
            filter: { _id: match._id },
            update: { $push: { announcedPlayers: entry } },
          },
        },
      ]);
    } else {
      await this.pushWithCapGuard(match, targetId, entry);
    }

    return this.finish(matchId, userId, current ? 'switched' : 'joined');
  }

  async leave(matchId: string, userId: string): Promise<GuestJoinState> {
    const match = await this.requireOpenUnrankedMatch(matchId);

    const res = await this.teamMatchModel.updateOne(
      { _id: match._id },
      {
        $pull: {
          announcedPlayers: {
            userId: new Types.ObjectId(userId),
            isGuest: true,
          },
        },
      },
    );
    if (!res.modifiedCount) {
      throw new NotFoundException('You have not joined this match');
    }

    return this.finish(matchId, userId, 'left');
  }

  async getStatus(matchId: string, userId: string): Promise<GuestJoinState> {
    const match = await requireTeamMatch(this.teamMatchModel, matchId);
    assertUnranked(match);
    return buildGuestJoinState(match, userId);
  }

  private async requireOpenUnrankedMatch(
    matchId: string,
  ): Promise<TeamMatchDocument> {
    const match = await requireTeamMatch(this.teamMatchModel, matchId);
    assertUnranked(match);
    assertMatchAllowsAnnouncedPlayerEdits(match);
    return match;
  }

  /** Reloads, broadcasts the new squad, pings both sides' staff, returns fresh state. */
  private async finish(
    matchId: string,
    userId: string,
    action: 'joined' | 'left' | 'switched',
  ): Promise<GuestJoinState> {
    const fresh = await requireTeamMatch(this.teamMatchModel, matchId);
    await this.realtimeDispatcher.dispatch({
      sport: fresh.sportType === SportType.FOOTBALL ? 'football' : 'cricket',
      teamMatchId: matchId,
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'announced_players_updated',
        announcedPlayers: fresh.announcedPlayers ?? [],
      },
    });
    await notifyGuestJoin(
      this.notificationService,
      this.teamMemberModel,
      this.teamService,
      {
        matchId,
        teamIds: [resolveId(fresh.fromTeam), resolveId(fresh.toTeam)],
        actorUserId: userId,
        action,
      },
    );
    return buildGuestJoinState(fresh, userId);
  }

  private async pushWithCapGuard(
    match: TeamMatchDocument,
    targetId: string,
    entry: AnnouncedPlayer,
  ): Promise<void> {
    const max = settingsOf(match).maxPerTeam;
    const targetOid = new Types.ObjectId(targetId);
    const filter: Record<string, unknown> = { _id: match._id };
    if (max > 0) {
      filter.$expr = {
        $lt: [
          {
            $size: {
              $filter: {
                input: '$announcedPlayers',
                cond: { $eq: ['$$this.teamId', targetOid] },
              },
            },
          },
          max,
        ],
      };
    }
    const res = await this.teamMatchModel.updateOne(filter, {
      $push: { announcedPlayers: entry },
    });
    if (!res.modifiedCount) {
      throw new ConflictException('This team is full');
    }
  }

  private async assertEligibleOutsider(
    match: TeamMatchDocument,
    userId: string,
  ): Promise<void> {
    for (const teamId of [resolveId(match.fromTeam), resolveId(match.toTeam)]) {
      const isMember = await this.teamMemberService.hasActiveMembership(
        teamId,
        userId,
      );
      if (isMember) {
        throw new BadRequestException(
          'Team members are added through the squad, not guest join',
        );
      }
    }
    const alreadyAnnounced = (match.announcedPlayers ?? []).some(
      (p) => announcedUserId(p) === userId,
    );
    if (alreadyAnnounced) {
      throw new ConflictException('You are already announced for this match');
    }
  }

  private async buildGuestEntry(
    userId: string,
    teamId: string,
    role: AnnouncedPlayerRole | undefined,
    sportType: SportType,
  ): Promise<AnnouncedPlayer> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      teamId: new Types.ObjectId(teamId),
      name: user.fullName?.trim() || 'Guest player',
      avatar: user.avatar,
      email: user.email,
      userId: new Types.ObjectId(userId),
      isGuest: true,
      is_substitute: false,
      is_substituted: false,
      substitute_count: 0,
      role: role ?? defaultAnnouncedPlayerRoleForSport(sportType),
      isCaption: false,
      isWiseCaption: false,
    };
  }
}
