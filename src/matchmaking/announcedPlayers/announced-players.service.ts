import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TeamService } from '../../team/team.service';
import { TeamMemberService } from '../../team-member/team-member.service';
import {
  AnnouncedPlayer,
  AnnouncedPlayerRole,
  TeamMatch,
  TeamMatchDocument,
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
import { StorageLifecycleService } from '../../storage/storage-lifecycle.service';
import { resolveId } from '../../core/utils/mongo-ref.util';

@Injectable()
export class AnnouncedPlayersService {
  constructor(
    @InjectModel(TeamMatch.name)
    private readonly teamMatchModel: Model<TeamMatchDocument>,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
    private readonly storageLifecycle: StorageLifecycleService,
  ) {}

  async addAnnouncedPlayers(
    matchId: string,
    userId: string,
    dto: AddAnnouncedPlayersDto,
  ): Promise<AnnouncedPlayer[]> {
    const match = await requireTeamMatch(this.teamMatchModel, matchId);
    assertMatchAllowsAnnouncedPlayerEdits(match);

    const actorTeam = await this.teamService.requireTeam(dto.actorTeamId);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    const actorOid = actorTeam._id;
    ensureMatchHasTeam(match, actorOid);

    const existing = [...(match.announcedPlayers ?? [])];
    const actorStr = resolveId(actorOid);

    const incomingIds = dto.players.map((p) => p.userId);
    if (new Set(incomingIds).size !== incomingIds.length) {
      throw new BadRequestException('Duplicate userId in players payload');
    }

    await this.assertUsersAreActiveMembers(
      actorOid,
      incomingIds.map((id) => new Types.ObjectId(id)),
    );

    for (const uid of incomingIds) {
      if (
        existing.some(
          (p) =>
            resolveId(p.teamId) === actorStr &&
            resolveId(p.userId) === resolveId(uid),
        )
      ) {
        throw new ConflictException(
          `User ${uid} is already in your announced squad`,
        );
      }
      if (
        existing.some(
          (p) =>
            resolveId(p.teamId) !== actorStr &&
            resolveId(p.userId) === resolveId(uid),
        )
      ) {
        throw new ConflictException(
          `User ${uid} is already announced for the opponent`,
        );
      }
    }

    const additions: AnnouncedPlayer[] = dto.players.map((p) => ({
      teamId: actorOid,
      name: p.name,
      avatar: p.avatar,
      email: p.email,
      userId: new Types.ObjectId(p.userId),
      is_substitute: p.is_substitute ?? false,
      role: p.role as AnnouncedPlayerRole,
      isCaption: p.isCaption ?? false,
      isWiseCaption: p.isWiseCaption ?? false,
    }));

    match.announcedPlayers = [...existing, ...additions];
    await match.save();

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
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    const actorOid = actorTeam._id;
    ensureMatchHasTeam(match, actorOid);

    const existing = [...(match.announcedPlayers ?? [])];
    const actorStr = resolveId(actorOid);

    for (const uid of dto.userIds) {
      const ok = existing.some(
        (p) =>
          resolveId(p.teamId) === actorStr &&
          resolveId(p.userId) === resolveId(uid),
      );
      if (!ok) {
        throw new BadRequestException(
          `User ${uid} is not in your announced squad on this match`,
        );
      }
    }
    const removeSet = new Set(dto.userIds.map((id) => resolveId(id)));
    const removedAvatars = existing
      .filter(
        (p) =>
          resolveId(p.teamId) === actorStr &&
          removeSet.has(resolveId(p.userId)) &&
          p.avatar,
      )
      .map((p) => p.avatar as string);

    match.announcedPlayers = existing.filter(
      (p) =>
        !(
          resolveId(p.teamId) === actorStr &&
          removeSet.has(resolveId(p.userId))
        ),
    );
    await match.save();

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
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
    const actorOid = actorTeam._id;
    ensureMatchHasTeam(match, actorOid);

    const existing = [...(match.announcedPlayers ?? [])];
    const actorStr = resolveId(actorOid);

    for (const u of dto.updates) {
      const idx = existing.findIndex(
        (p) =>
          resolveId(p.teamId) === actorStr &&
          resolveId(p.userId) === resolveId(u.userId),
      );
      if (idx === -1) {
        throw new BadRequestException(
          `User ${u.userId} is not in your announced squad on this match`,
        );
      }
      const row = existing[idx];
      if (u.avatar !== undefined) {
        const previousAvatar = row.avatar;
        row.avatar = u.avatar;
        await this.storageLifecycle.syncUrlArrayOnEntitySave({
          userId,
          entityType: 'announced_player',
          entityId: `${matchId}:${u.userId}`,
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
    return this.announcedPlayersForTeam(match, actorOid);
  }

  async getAnnouncedPlayersForTeam(
    matchId: string,
    userId: string,
    actorTeamId: string,
  ): Promise<AnnouncedPlayer[]> {
    if (!actorTeamId?.trim()) {
      throw new BadRequestException(
        'actorTeamId query parameter is required',
      );
    }
    const match = await requireTeamMatch(this.teamMatchModel, matchId);
    const actorTeam = await this.teamService.requireTeam(actorTeamId);
    await assertCanActForTeam(
      actorTeam,
      userId,
      this.teamService,
      this.teamMemberService,
    );
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
