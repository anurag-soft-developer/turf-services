import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  TeamInvite,
  TeamInviteDocument,
  TeamInviteStatus,
} from './schemas/team-invite.schema';
import { TeamService } from '../team/team.service';
import { TeamMemberService } from '../team-member/team-member.service';
import { UsersService } from '../users/users.service';
import { NotificationService } from '../notification/notification.service';
import { EmailService } from '../core/services/email.service';
import { SmsService } from '../core/services/sms.service';
import { PaginatedResult } from '../core/interfaces/common';
import { resolveId } from '../core/utils/mongo-ref.util';
import { userSelectFields } from '../users/schemas/user.schema';
import { teamPopulateSelectFields } from '../team/schemas/team.schema';
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
  requireInvite,
  requireInviteById,
} from './utility/team-invite-validation.utility';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class TeamInviteService {
  private readonly logger = new Logger(TeamInviteService.name);

  private static readonly populate = [
    { path: 'team', select: teamPopulateSelectFields },
    { path: 'invitedBy', select: userSelectFields },
    { path: 'inviteeUser', select: userSelectFields },
  ];

  constructor(
    @InjectModel(TeamInvite.name)
    private readonly teamInviteModel: Model<TeamInviteDocument>,
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
  ): Promise<TeamInviteDocument> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone;

    const invitee = email
      ? await this.usersService.findByEmail(email)
      : await this.usersService.findByPhone(phone!);

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

      const existingForUser = await this.teamInviteModel.findOne({
        team: new Types.ObjectId(teamId),
        inviteeUser: invitee._id,
        status: TeamInviteStatus.PENDING,
      });
      if (existingForUser) {
        throw new ConflictException(
          'A pending invite already exists for this user',
        );
      }
    }

    const contactFilter = email
      ? { email, status: TeamInviteStatus.PENDING }
      : { phone, status: TeamInviteStatus.PENDING };
    const existingContact = await this.teamInviteModel.findOne({
      team: new Types.ObjectId(teamId),
      ...contactFilter,
    });
    if (existingContact) {
      throw new ConflictException(
        'A pending invite already exists for this contact',
      );
    }

    const inviter = await this.usersService.findById(ownerUserId);
    const inviterName = inviter?.fullName ?? 'A team owner';

    const doc = new this.teamInviteModel({
      team: new Types.ObjectId(teamId),
      invitedBy: new Types.ObjectId(ownerUserId),
      inviteeUser: invitee?._id,
      email: email || undefined,
      phone: phone || undefined,
      token: randomBytes(24).toString('hex'),
      status: TeamInviteStatus.PENDING,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    let saved: TeamInviteDocument;
    try {
      saved = await doc.save();
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

    return (await saved.populate(
      TeamInviteService.populate,
    )) as TeamInviteDocument;
  }

  async listForTeam(
    teamId: string,
    ownerUserId: string,
    status: TeamInviteStatus | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<TeamInviteDocument>> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const filter: Record<string, unknown> = {
      team: new Types.ObjectId(teamId),
    };
    if (status) {
      filter.status = status;
    }

    const skip = (page - 1) * limit;
    const [data, totalDocuments] = await Promise.all([
      this.teamInviteModel
        .find(filter)
        .populate(TeamInviteService.populate)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.teamInviteModel.countDocuments(filter),
    ]);

    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async listForInvitee(
    userId: string,
    status: TeamInviteStatus | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<TeamInviteDocument>> {
    await this.attachUserToPendingInvites({ userId });

    const filter: Record<string, unknown> = {
      inviteeUser: new Types.ObjectId(userId),
    };
    if (status) {
      filter.status = status;
    }

    const skip = (page - 1) * limit;
    const [data, totalDocuments] = await Promise.all([
      this.teamInviteModel
        .find(filter)
        .populate(TeamInviteService.populate)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.teamInviteModel.countDocuments(filter),
    ]);

    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async revoke(
    teamId: string,
    inviteId: string,
    ownerUserId: string,
  ): Promise<{ success: true }> {
    const team = await this.teamService.requireTeam(teamId);
    this.teamService.assertOwner(team, ownerUserId);

    const invite = await requireInvite(
      this.teamInviteModel,
      inviteId,
      teamId,
    );
    if (invite.status !== TeamInviteStatus.PENDING) {
      throw new BadRequestException('Only pending invites can be revoked');
    }

    await this.teamInviteModel.deleteOne({ _id: invite._id });
    return { success: true };
  }

  async accept(
    inviteId: string,
    userId: string,
  ): Promise<TeamInviteDocument> {
    const invite = await requireInviteById(this.teamInviteModel, inviteId);
    assertInvitee(invite, userId);
    await ensurePendingNotExpired(invite);

    const teamId = resolveId(invite.team);
    await this.teamMemberService.createActiveFromInvite(teamId, userId);

    invite.status = TeamInviteStatus.ACCEPTED;
    invite.respondedAt = new Date();
    await invite.save();

    const team = await this.teamService.requireTeam(teamId);
    await notifyTeamInviteAccepted(
      this.notificationService,
      team,
      inviteId,
      userId,
    );

    return (await invite.populate(
      TeamInviteService.populate,
    )) as TeamInviteDocument;
  }

  async reject(
    inviteId: string,
    userId: string,
  ): Promise<TeamInviteDocument> {
    const invite = await requireInviteById(this.teamInviteModel, inviteId);
    assertInvitee(invite, userId);
    await ensurePendingNotExpired(invite);

    invite.status = TeamInviteStatus.REJECTED;
    invite.respondedAt = new Date();
    await invite.save();

    const teamId = resolveId(invite.team);
    const team = await this.teamService.requireTeam(teamId);
    await notifyTeamInviteRejected(
      this.notificationService,
      team,
      inviteId,
      userId,
    );

    return (await invite.populate(
      TeamInviteService.populate,
    )) as TeamInviteDocument;
  }

  /**
   * Links pending invites (by email/phone) to the user and notifies them.
   * Idempotent — safe to call on register and login.
   */
  async attachUserToPendingInvites(params: {
    userId: string;
    email?: string;
    phone?: string;
  }): Promise<TeamInviteDocument[]> {
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

    const unclaimed = await this.teamInviteModel.find({
      status: TeamInviteStatus.PENDING,
      expiresAt: { $gt: new Date() },
      $and: [
        { $or: contactOr },
        {
          $or: [{ inviteeUser: { $exists: false } }, { inviteeUser: null }],
        },
      ],
    });

    const attached: TeamInviteDocument[] = [];
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
}
