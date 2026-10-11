import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TeamService } from '../../team/team.service';
import {
  LeadershipRole,
  TeamMemberStatus,
} from '../../team-member/schemas/team-member.schema';
import { TeamMemberService } from '../../team-member/team-member.service';
import { UsersService } from '../../users/users.service';
import { NotificationService } from '../../notification/notification.service';
import { EmailService } from '../../core/services/email.service';
import { SmsService } from '../../core/services/sms.service';
import { PaginatedResult } from '../../core/interfaces/common';
import { resolveId } from '../../core/utils/mongo-ref.util';
import { userSelectFields } from '../../users/schemas/user.schema';
import { teamPopulateSelectFields } from '../../team/schemas/team.schema';
import {
  InvitationKind,
  InvitationStatus,
  TournamentInvitationDirection,
} from '../invitation.constants';
import { Invitation, InvitationDocument } from '../schemas/invitation.schema';
import { paginateInvitations } from '../shared/invitation-query.util';
import { CreateTeamInviteDto } from './dto/team-invite.dto';
import {
  notifyTeamInvite,
  notifyTeamInviteAccepted,
  notifyTeamInviteRejected,
  sendOutboundInvite,
} from './utility/team-invite-notification.utility';
import {
  assertInvitee,
  ensurePendingNotExpired,
  requireTeamInvite,
} from './utility/team-invite-validation.utility';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class TeamInviteService {
  private readonly logger = new Logger(TeamInviteService.name);

  private static readonly populate = [
    { path: 'team', select: teamPopulateSelectFields },
    { path: 'invitedBy', select: userSelectFields },
    { path: 'inviteeUser', select: userSelectFields },
    { path: 'tournament', select: 'name' },
  ];

  constructor(
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<InvitationDocument>,
    private readonly teamService: TeamService,
    private readonly teamMemberService: TeamMemberService,
    private readonly usersService: UsersService,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
  ) {}

  async create(
    teamId: string,
    ownerUserId: string,
    dto: CreateTeamInviteDto,
  ): Promise<InvitationDocument> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    let email = dto.email?.trim().toLowerCase();
    let phone = dto.phone;
    let invitee =
      email != null
        ? await this.usersService.findByEmail(email)
        : phone != null
          ? await this.usersService.findByPhone(phone)
          : null;

    if (dto.inviteeUserId) {
      invitee = await this.usersService.findById(dto.inviteeUserId);
      if (!invitee || !invitee.isActive) {
        throw new BadRequestException('User not found');
      }
      email = invitee.email?.trim().toLowerCase() || undefined;
      phone = invitee.phone || undefined;
      if (!email && !phone) {
        throw new BadRequestException(
          'This user has no email or phone on file to invite',
        );
      }
    }

    if (invitee) {
      const inviteeId = invitee._id.toString();
      if (resolveId(inviteeId) === resolveId(ownerUserId)) {
        throw new BadRequestException('You cannot invite yourself');
      }
      const hasOpen = await this.teamMemberService.hasOpenStint(
        teamId,
        inviteeId,
      );
      if (hasOpen) {
        throw new ConflictException(
          'This user already has an active, pending, or suspended membership for this team',
        );
      }

      const existingForUser = await this.invitationModel
        .findOne({
          kind: InvitationKind.TEAM_INVITE,
          team: new Types.ObjectId(teamId),
          inviteeUser: invitee._id,
          status: InvitationStatus.PENDING,
        })
        .exec();
      if (existingForUser) {
        throw new ConflictException(
          'A pending invite already exists for this user',
        );
      }
    }

    const contactFilter = email
      ? { email, status: InvitationStatus.PENDING }
      : { phone, status: InvitationStatus.PENDING };
    const existingContact = await this.invitationModel
      .findOne({
        kind: InvitationKind.TEAM_INVITE,
        team: new Types.ObjectId(teamId),
        ...contactFilter,
      })
      .exec();
    if (existingContact) {
      throw new ConflictException(
        'A pending invite already exists for this contact',
      );
    }

    const inviter = await this.usersService.findById(ownerUserId);
    const inviterName = inviter?.fullName ?? 'A team owner';

    let saved: InvitationDocument;
    try {
      saved = await this.invitationModel.create({
        kind: InvitationKind.TEAM_INVITE,
        team: new Types.ObjectId(teamId),
        invitedBy: new Types.ObjectId(ownerUserId),
        inviteeUser: invitee?._id,
        email: email || undefined,
        phone: phone || undefined,
        token: randomBytes(24).toString('hex'),
        status: InvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      });
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: number }).code === 11000
      ) {
        throw new ConflictException(
          'A pending invite already exists for this contact',
        );
      }
      throw err;
    }

    if (invitee) {
      await notifyTeamInvite(this.notificationService, {
        recipientUserId: invitee._id.toString(),
        team,
        inviteId: saved._id.toString(),
        actorUserId: ownerUserId,
      });
    }

    await sendOutboundInvite(this.emailService, this.smsService, {
      email,
      phone,
      teamName: team.name,
      inviterName,
      inviteeName: invitee?.fullName,
    });

    return saved.populate(TeamInviteService.populate);
  }

  async listForTeam(
    teamId: string,
    ownerUserId: string,
    status: InvitationStatus | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<InvitationDocument>> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const filter: Record<string, unknown> = {
      kind: InvitationKind.TEAM_INVITE,
      team: new Types.ObjectId(teamId),
    };
    if (status) {
      filter.status = status;
    }

    return paginateInvitations(
      this.invitationModel,
      filter,
      page,
      limit,
      TeamInviteService.populate,
    );
  }

  async listForInvitee(
    userId: string,
    status: InvitationStatus | undefined,
    page: number,
    limit: number,
    kind: InvitationKind | undefined,
  ): Promise<PaginatedResult<InvitationDocument>> {
    await this.attachUserToPendingInvites({ userId });

    const userObjectId = new Types.ObjectId(userId);
    const branches: Record<string, unknown>[] = [];
    if (kind == null || kind === InvitationKind.TEAM_INVITE) {
      branches.push({
        kind: InvitationKind.TEAM_INVITE,
        inviteeUser: userObjectId,
      });
    }
    if (kind == null || kind === InvitationKind.TOURNAMENT_INVITE) {
      const teamIds = await this.actingTeamIds(userId);
      if (teamIds.length) {
        branches.push({
          kind: InvitationKind.TOURNAMENT_INVITE,
          direction: TournamentInvitationDirection.INVITE,
          team: { $in: teamIds },
        });
      }
    }
    if (!branches.length) {
      return {
        data: [],
        totalDocuments: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    const filter: Record<string, unknown> = { $or: branches };
    if (status) {
      filter.status = status;
    }

    return paginateInvitations(
      this.invitationModel,
      filter,
      page,
      limit,
      TeamInviteService.populate,
    );
  }

  /** Teams whose owner, captain, or vice-captain can answer a tournament invite. */
  private async actingTeamIds(userId: string): Promise<Types.ObjectId[]> {
    const [owned, leadership] = await Promise.all([
      this.teamService.distinctOwnedActiveTeamIds(userId),
      this.teamMemberService.distinctTeamIdsByMembershipFilter({
        user: new Types.ObjectId(userId),
        status: TeamMemberStatus.ACTIVE,
        leadershipRole: {
          $in: [LeadershipRole.CAPTAIN, LeadershipRole.VICE_CAPTAIN],
        },
      }),
    ]);
    const ids = new Map<string, Types.ObjectId>();
    for (const id of [...owned, ...leadership]) {
      ids.set(id.toString(), new Types.ObjectId(id.toString()));
    }
    return [...ids.values()];
  }

  async revoke(
    teamId: string,
    invitationId: string,
    ownerUserId: string,
  ): Promise<{ success: true }> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const invite = await requireTeamInvite(
      this.invitationModel,
      invitationId,
      teamId,
    );
    if (invite.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invites can be revoked');
    }

    await this.invitationModel.deleteOne({ _id: invite._id }).exec();
    return { success: true };
  }

  async accept(
    invitationId: string,
    userId: string,
  ): Promise<InvitationDocument> {
    const invite = await requireTeamInvite(this.invitationModel, invitationId);
    assertInvitee(invite, userId);
    await ensurePendingNotExpired(invite);

    const teamId = resolveId(invite.team);
    await this.teamMemberService.createActiveFromInvite(teamId, userId);

    invite.status = InvitationStatus.ACCEPTED;
    invite.decidedAt = new Date();
    invite.decidedBy = new Types.ObjectId(userId);
    await invite.save();

    const team = await this.teamService.requireTeam(teamId);
    await notifyTeamInviteAccepted(
      this.notificationService,
      team,
      invitationId,
      userId,
    );

    return invite.populate(TeamInviteService.populate);
  }

  async decline(
    invitationId: string,
    userId: string,
  ): Promise<InvitationDocument> {
    const invite = await requireTeamInvite(this.invitationModel, invitationId);
    assertInvitee(invite, userId);
    await ensurePendingNotExpired(invite);

    invite.status = InvitationStatus.DECLINED;
    invite.decidedAt = new Date();
    invite.decidedBy = new Types.ObjectId(userId);
    await invite.save();

    const teamId = resolveId(invite.team);
    const team = await this.teamService.requireTeam(teamId);
    await notifyTeamInviteRejected(
      this.notificationService,
      team,
      invitationId,
      userId,
    );

    return invite.populate(TeamInviteService.populate);
  }

  /**
   * Links pending invites (by email/phone) to the user and notifies them.
   * Idempotent — safe to call on register and login.
   */
  async attachUserToPendingInvites(params: {
    userId: string;
    email?: string;
    phone?: string;
  }): Promise<InvitationDocument[]> {
    let email = params.email?.trim().toLowerCase();
    let phone = params.phone;

    if (!email && !phone) {
      const user = await this.usersService.findById(params.userId);
      email = user?.email?.trim().toLowerCase();
      phone = user?.phone;
    }

    if (!email && !phone) {
      return [];
    }

    const contactOr: Record<string, unknown>[] = [];
    if (email) contactOr.push({ email });
    if (phone) contactOr.push({ phone });

    const unclaimed = await this.invitationModel
      .find({
        kind: InvitationKind.TEAM_INVITE,
        status: InvitationStatus.PENDING,
        expiresAt: { $gt: new Date() },
        $and: [
          { $or: contactOr },
          {
            $or: [{ inviteeUser: { $exists: false } }, { inviteeUser: null }],
          },
        ],
      })
      .exec();

    const attached: InvitationDocument[] = [];
    for (const invite of unclaimed) {
      invite.inviteeUser = new Types.ObjectId(params.userId);
      await invite.save();
      attached.push(invite);

      try {
        const team = await this.teamService.requireTeam(resolveId(invite.team));
        await notifyTeamInvite(this.notificationService, {
          recipientUserId: params.userId,
          team,
          inviteId: invite._id.toString(),
          actorUserId: resolveId(invite.invitedBy),
        });
      } catch (err) {
        this.logger.warn(
          `Failed to notify attached invite ${invite._id.toString()}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    return attached;
  }

  /** Bulk-expire pending team invites past expiresAt (scheduled cleanup). */
  async expirePendingInvites(): Promise<number> {
    const now = new Date();
    const result = await this.invitationModel
      .updateMany(
        {
          kind: InvitationKind.TEAM_INVITE,
          status: InvitationStatus.PENDING,
          expiresAt: { $lte: now },
        },
        {
          $set: {
            status: InvitationStatus.EXPIRED,
            decidedAt: now,
          },
        },
      )
      .exec();
    return result.modifiedCount;
  }
}
