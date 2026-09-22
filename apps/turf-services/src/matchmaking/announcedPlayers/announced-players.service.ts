import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TeamService } from '../../team/team.service';
import { TeamMemberService } from '../../team-member/team-member.service';
import type { TeamDocument } from '../../team/schemas/team.schema';
import {
  AnnouncedPlayer,
  AnnouncedPlayerRole,
  TeamMatch,
  TeamMatchDocument,
  TeamMatchSource,
} from '../schemas/team-match.schema';
import {
  assertCanActForTeam,
  assertMatchAllowsAnnouncedPlayerEdits,
  ensureMatchHasTeam,
  requireTeamMatch,
} from '../util/matchmaking.helpers';
import {
  AddAnnouncedPlayersDto,
  RemoveAnnouncedPlayersDto,
  UpdateAnnouncedPlayersDto,
} from './dto/announced-players.dto';
import { NotificationService } from '../../notification/notification.service';
import { notifyAnnouncedPlayers } from '../util/matchmaking-notification.utility';
import { StorageLifecycleService } from '../../storage/storage-lifecycle.service';
import { resolveId } from '../../core/utils/mongo-ref.util';
import { ScoringRealtimeDispatcher } from '../../scoring/common/scoring-realtime-dispatcher.service';
import { SportType } from '../../team/schemas/team.schema';
import { UsersService } from '../../users/users.service';
import {
  announcedGuestId,
  announcedUserId,
} from './announced-player.identity';

@Injectable()
export class AnnouncedPlayersService {
  constructor(
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
    private readonly notificationService: NotificationService,
    private readonly storageLifecycle: StorageLifecycleService,
    private readonly realtimeDispatcher: ScoringRealtimeDispatcher,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Leadership (or owner) can always announce.
   * On casual matches, any active member of the actor team can announce
   * (supports users who belong to both sides).
   */
  private async assertCanAnnounceForTeam(
    match: TeamMatchDocument,
    actorTeam: TeamDocument,
    userId: string,
  ): Promise<void> {
    try {
      await assertCanActForTeam(
        actorTeam,
        userId,
        this.teamService,
        this.teamMemberService,
      );
      return;
    } catch (err) {
      if (match.source !== TeamMatchSource.CASUAL) throw err;
    }
    const isMember = await this.teamMemberService.hasActiveMembership(
      actorTeam._id.toString(),
      userId,
    );
    if (!isMember && !this.teamService.isOwner(actorTeam, userId)) {
      throw new ForbiddenException(
        'Only team members can announce players for this casual match',
      );
    }
  }
  private async dispatchAnnouncedPlayersUpdated(
    match: TeamMatchDocument,
    userId: string,
  ): Promise<void> {
    await this.realtimeDispatcher.dispatch({
      sport: match.sportType === SportType.FOOTBALL ? 'football' : 'cricket',
      teamMatchId: match._id.toString(),
      actorUserId: userId,
      action: 'append_event',
      data: {
        kind: 'announced_players_updated',
        announcedPlayers: match.announcedPlayers ?? [],
      },
    });
  }

  async addAnnouncedPlayers(
    matchId: string,
    userId: string,
    dto: AddAnnouncedPlayersDto,
  ): Promise<AnnouncedPlayer[]> {
    const match = await requireTeamMatch(this.teamMatchModel, matchId);
    assertMatchAllowsAnnouncedPlayerEdits(match);

    const actorTeam = await this.teamService.requireTeam(dto.actorTeamId);
    await this.assertCanAnnounceForTeam(match, actorTeam, userId);
    const actorOid = actorTeam._id;
    ensureMatchHasTeam(match, actorOid);

    const existing = [...(match.announcedPlayers ?? [])];
    const actorStr = resolveId(actorOid);

    const incomingUserIds = dto.players
      .map((p) => p.userId)
      .filter((id): id is string => !!id);
    if (new Set(incomingUserIds).size !== incomingUserIds.length) {
      throw new BadRequestException('Duplicate userId in players payload');
    }

    const isCasual = match.source === TeamMatchSource.CASUAL;
    for (const p of dto.players) {
      if (p.isGuest && !isCasual) {
        throw new BadRequestException(
          'Guests can only be announced on casual matches',
        );
      }
    }

    const rosterUserIds = dto.players
      .filter((p) => !p.isGuest && p.userId)
      .map((p) => new Types.ObjectId(p.userId));
    await this.assertUsersAreActiveMembers(actorOid, rosterUserIds);

    const registeredGuestUserIds = dto.players
      .filter((p) => p.isGuest && p.userId)
      .map((p) => p.userId as string);
    if (registeredGuestUserIds.length) {
      const users = await this.usersService.findById(registeredGuestUserIds);
      const found = new Set(users.map((u) => u._id.toString()));
      for (const uid of registeredGuestUserIds) {
        if (!found.has(uid)) {
          throw new BadRequestException(`User ${uid} was not found`);
        }
      }
    }

    for (const uid of incomingUserIds) {
      if (
        existing.some(
          (p) =>
            resolveId(p.teamId) === actorStr && announcedUserId(p) === uid,
        )
      ) {
        throw new ConflictException(
          `User ${uid} is already in your announced squad`,
        );
      }
      if (
        existing.some(
          (p) =>
            resolveId(p.teamId) !== actorStr && announcedUserId(p) === uid,
        )
      ) {
        throw new ConflictException(
          `User ${uid} is already announced for the opponent`,
        );
      }
    }

    const additions: AnnouncedPlayer[] = dto.players.map((p) => {
      const isWalkIn = p.isGuest && !p.userId;
      return {
        teamId: actorOid,
        name: p.name,
        avatar: p.avatar,
        email: p.email,
        ...(p.userId ? { userId: new Types.ObjectId(p.userId) } : {}),
        isGuest: p.isGuest ?? false,
        ...(isWalkIn ? { guestId: new Types.ObjectId() } : {}),
        is_substitute: p.is_substitute ?? false,
        is_substituted: false,
        substitute_count: 0,
        role: p.role as AnnouncedPlayerRole,
        isCaption: p.isCaption ?? false,
        isWiseCaption: p.isWiseCaption ?? false,
      };
    });

    match.announcedPlayers = [...existing, ...additions];
    await match.save();
    await this.dispatchAnnouncedPlayersUpdated(match, userId);
    const notifyUserIds = dto.players
      .filter((p) => !p.isGuest && p.userId)
      .map((p) => p.userId as string);
    if (notifyUserIds.length > 0) {
      await notifyAnnouncedPlayers(this.notificationService, {
        userIds: notifyUserIds,
        matchId,
        added: true,
        excludeUserId: userId,
      });
    }

    const addedAvatars = additions
      .map((p) => p.avatar)
      .filter((avatar): avatar is string => !!avatar);
    if (addedAvatars.length > 0) {
      await this.storageLifecycle.syncUrlArrayOnEntitySave({
        userId,
        entityType: 'announced_player',
        entityId: matchId,
        previousUrls: [],
        nextUrls: addedAvatars,
      });
    }

    return this.announcedPlayersForTeam(match, actorOid);
  }

  async removeAnnouncedPlayers(
    matchId: string,
    userId: string,
    dto: RemoveAnnouncedPlayersDto,
  ): Promise<AnnouncedPlayer[]> {
    const match = await requireTeamMatch(this.teamMatchModel, matchId);
    assertMatchAllowsAnnouncedPlayerEdits(match);

    const actorTeam = await this.teamService.requireTeam(dto.actorTeamId);
    await this.assertCanAnnounceForTeam(match, actorTeam, userId);
    const actorOid = actorTeam._id;
    ensureMatchHasTeam(match, actorOid);

    const existing = [...(match.announcedPlayers ?? [])];
    const actorStr = resolveId(actorOid);

    const removeUserSet = new Set((dto.userIds ?? []).map((id) => resolveId(id)));
    const removeGuestSet = new Set(
      (dto.guestIds ?? []).map((id) => resolveId(id)),
    );

    for (const uid of removeUserSet) {
      const ok = existing.some(
        (p) =>
          resolveId(p.teamId) === actorStr && announcedUserId(p) === uid,
      );
      if (!ok) {
        throw new BadRequestException(
          `User ${uid} is not in your announced squad on this match`,
        );
      }
    }
    for (const gid of removeGuestSet) {
      const ok = existing.some(
        (p) =>
          resolveId(p.teamId) === actorStr && announcedGuestId(p) === gid,
      );
      if (!ok) {
        throw new BadRequestException(
          `Guest ${gid} is not in your announced squad on this match`,
        );
      }
    }

    const shouldRemove = (p: AnnouncedPlayer): boolean => {
      if (resolveId(p.teamId) !== actorStr) return false;
      const uid = announcedUserId(p);
      const gid = announcedGuestId(p);
      return (
        (uid != null && removeUserSet.has(uid)) ||
        (gid != null && removeGuestSet.has(gid))
      );
    };

    const removed = existing.filter(shouldRemove);
    const removedAvatars = removed
      .map((p) => p.avatar)
      .filter((avatar): avatar is string => !!avatar);

    match.announcedPlayers = existing.filter((p) => !shouldRemove(p));
    await match.save();
    await this.dispatchAnnouncedPlayersUpdated(match, userId);
    const notifyUserIds = removed
      .filter((p) => !p.isGuest)
      .map((p) => announcedUserId(p))
      .filter((id): id is string => !!id);
    if (notifyUserIds.length > 0) {
      await notifyAnnouncedPlayers(this.notificationService, {
        userIds: notifyUserIds,
        matchId,
        added: false,
        excludeUserId: userId,
      });
    }

    if (removedAvatars.length > 0) {
      await this.storageLifecycle.deleteUrlsForUser(userId, removedAvatars);
    }

    return this.announcedPlayersForTeam(match, actorOid);
  }

  async updateAnnouncedPlayers(
    matchId: string,
    userId: string,
    dto: UpdateAnnouncedPlayersDto,
  ): Promise<AnnouncedPlayer[]> {
    const match = await requireTeamMatch(this.teamMatchModel, matchId);
    assertMatchAllowsAnnouncedPlayerEdits(match);

    const actorTeam = await this.teamService.requireTeam(dto.actorTeamId);
    await this.assertCanAnnounceForTeam(match, actorTeam, userId);
    const actorOid = actorTeam._id;
    ensureMatchHasTeam(match, actorOid);

    const existing = [...(match.announcedPlayers ?? [])];
    const actorStr = resolveId(actorOid);

    for (const u of dto.updates) {
      const idx = existing.findIndex((p) => {
        if (resolveId(p.teamId) !== actorStr) return false;
        if (u.userId) return announcedUserId(p) === resolveId(u.userId);
        if (u.guestId) return announcedGuestId(p) === resolveId(u.guestId);
        return false;
      });
      if (idx === -1) {
        throw new BadRequestException(
          `${u.userId ? `User ${u.userId}` : `Guest ${u.guestId}`} is not in your announced squad on this match`,
        );
      }
      const row = existing[idx];
      if (u.avatar !== undefined) {
        const previousAvatar = row.avatar;
        row.avatar = u.avatar;
        await this.storageLifecycle.syncUrlArrayOnEntitySave({
          userId,
          entityType: 'announced_player',
          entityId: `${matchId}:${u.userId ?? u.guestId}`,
          previousUrls: previousAvatar ? [previousAvatar] : [],
          nextUrls: u.avatar ? [u.avatar] : [],
        });
      }
      if (u.name !== undefined) row.name = u.name;
      if (u.email !== undefined) row.email = u.email;
      if (u.is_substitute !== undefined) row.is_substitute = u.is_substitute;
      if (u.role !== undefined) row.role = u.role as AnnouncedPlayerRole;
      if (u.isCaption !== undefined) row.isCaption = u.isCaption;
      if (u.isWiseCaption !== undefined) row.isWiseCaption = u.isWiseCaption;
    }
    match.announcedPlayers = existing;
    match.markModified('announcedPlayers');
    await match.save();
    await this.dispatchAnnouncedPlayersUpdated(match, userId);
    return this.announcedPlayersForTeam(match, actorOid);
  }

  async getAnnouncedPlayersForTeam(
    matchId: string,
    userId: string,
    actorTeamId: string,
  ): Promise<AnnouncedPlayer[]> {
    if (!actorTeamId?.trim()) {
      throw new BadRequestException('actorTeamId query parameter is required');
    }
    const match = await requireTeamMatch(this.teamMatchModel, matchId);
    const actorTeam = await this.teamService.requireTeam(actorTeamId);
    await this.assertCanAnnounceForTeam(match, actorTeam, userId);
    ensureMatchHasTeam(match, actorTeam._id);
    return this.announcedPlayersForTeam(match, actorTeam._id);
  }

  private announcedPlayersForTeam(
    match: TeamMatchDocument,
    teamId: Types.ObjectId,
  ): AnnouncedPlayer[] {
    const tid = resolveId(teamId);
    return (match.announcedPlayers ?? []).filter(
      (p) => resolveId(p.teamId) === tid,
    );
  }

  private async assertUsersAreActiveMembers(
    teamId: Types.ObjectId,
    userIds: Types.ObjectId[],
  ): Promise<void> {
    for (const uid of userIds) {
      const ok = await this.teamMemberService.hasActiveMembership(
        teamId.toString(),
        uid.toString(),
      );
      if (!ok) {
        throw new BadRequestException(
          `User ${uid.toString()} is not an active member of team ${teamId.toString()}`,
        );
      }
    }
  }
}
