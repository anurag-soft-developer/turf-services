import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  GeoPoint,
  JoinRequestEntry,
  JoinRequestStatus,
  LocalMatch,
  LocalMatchDocument,
  LocalMatchJoinMode,
  LocalMatchLocation,
  LocalMatchStatus,
  LocalMatchVisibility,
} from './schemas/local-match.schema';
import { TurfDocument, turfSelectFields } from '../turf/schemas/turf.schema';
import { TurfService } from '../turf/turf.service';
import {
  CreateLocalMatchDto,
  LocalMatchFilterDto,
  PromoteHostDto,
  UpdateLocalMatchDto,
} from './dto/local-match.dto';
import omitEmpty from 'omit-empty';
import { ConnectionsService } from '../connections/connections.service';
import { PaginatedResult } from '../common/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';

@Injectable()
export class LocalMatchService {
  private static readonly populate = [
    { path: 'createdBy', select: userSelectFields },
    { path: 'turf', select: turfSelectFields },
    // { path: 'hostIds', select: userSelectFields },
    { path: 'members.user', select: userSelectFields },
    { path: 'joinRequests.user', select: userSelectFields },
    { path: 'joinRequests.reviewedBy', select: userSelectFields },
  ];

  constructor(
    @InjectModel(LocalMatch.name)
    private localMatchModel: Model<LocalMatchDocument>,
    private connectionsService: ConnectionsService,
    private turfService: TurfService,
  ) {}

  async create(
    userId: string,
    dto: CreateLocalMatchDto,
  ): Promise<LocalMatchDocument> {
    const uid = new Types.ObjectId(userId);
    const {
      closingTime,
      eventStartsAt,
      eventEndsAt,
      location,
      turf: turfId,
      ...fromDto
    } = dto;

    let resolvedLocation = location as LocalMatchLocation | undefined;
    let turfRef: Types.ObjectId | undefined;
    if (turfId) {
      turfRef = new Types.ObjectId(turfId);
      if (!resolvedLocation) {
        const turf = await this.turfService.findById(turfId);
        resolvedLocation = this.localMatchLocationFromTurf(turf);
      }
    }
    if (!resolvedLocation) {
      throw new BadRequestException('Provide location or turf');
    }

    const doc = new this.localMatchModel({
      ...fromDto,
      turf: turfRef,
      location: resolvedLocation,
      createdBy: uid,
      hostIds: [uid],
      members: [{ user: uid, joinedAt: new Date() }],
      closingTime: new Date(closingTime),
      eventStartsAt: eventStartsAt ? new Date(eventStartsAt) : undefined,
      eventEndsAt: eventEndsAt ? new Date(eventEndsAt) : undefined,
      status: LocalMatchStatus.OPEN,
    });

    const saved = await doc.save();
    return (await saved.populate(
      LocalMatchService.populate,
    )) as LocalMatchDocument;
  }

  async findById(id: string, viewerId: string): Promise<LocalMatchDocument> {
    const match = await this.localMatchModel
      .findById(id)
      .populate(LocalMatchService.populate)
      .exec();

    if (!match) {
      throw new NotFoundException('Local match not found');
    }

    this.assertCanView(match, viewerId);
    return match;
  }

  async findMany(
    userId: string,
    filter: LocalMatchFilterDto,
  ): Promise<PaginatedResult<LocalMatchDocument>> {
    const {
      visibility,
      status,
      sportTypes,
      nearbyLat,
      nearbyLng,
      nearbyRadiusKm = 10,
      page = 1,
      limit = 10,
    } = filter;

    const uid = new Types.ObjectId(userId);
    const accessOr = [
      { visibility: LocalMatchVisibility.PUBLIC },
      { hostIds: uid },
      { 'members.user': uid },
    ];

    const baseMatch: Record<string, unknown> = {
      $or: accessOr,
    };

    if (visibility) {
      baseMatch.visibility = visibility;
    }
    if (status) {
      baseMatch.status = status;
    }
    if (sportTypes?.length) {
      baseMatch.sportTypes = { $in: sportTypes };
    }

    const skip = (page - 1) * limit;

    if (nearbyLat !== undefined && nearbyLng !== undefined) {
      const pipeline: PipelineStage[] = [
        {
          $geoNear: {
            key: 'location.coordinates',
            near: {
              type: 'Point',
              coordinates: [nearbyLng, nearbyLat],
            },
            distanceField: 'distance',
            maxDistance: nearbyRadiusKm * 1000,
            spherical: true,
            query: baseMatch,
          },
        },
        {
          $facet: {
            metadata: [{ $count: 'total' }],
            data: [{ $skip: skip }, { $limit: limit }],
          },
        },
      ];

      const agg = await this.localMatchModel.aggregate(pipeline);
      const metadata = agg[0]?.metadata[0] || { total: 0 };
      const raw = agg[0]?.data || [];
      const ids = raw.map((d: { _id: Types.ObjectId }) => d._id);
      const docs = await this.localMatchModel
        .find({ _id: { $in: ids } })
        .populate(LocalMatchService.populate)
        .exec();
      const order = new Map<string, number>(
        ids.map((id: Types.ObjectId, i: number) => [id.toString(), i]),
      );
      docs.sort((a, b) => {
        const ia: number = order.get(a._id.toString()) ?? 0;
        const ib: number = order.get(b._id.toString()) ?? 0;
        return ia - ib;
      });

      const total = metadata.total ?? 0;
      return {
        data: docs,
        totalDocuments: total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 0,
      };
    }

    const [data, totalDocuments] = await Promise.all([
      this.localMatchModel
        .find(baseMatch)
        .populate(LocalMatchService.populate)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.localMatchModel.countDocuments(baseMatch),
    ]);

    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateLocalMatchDto,
  ): Promise<LocalMatchDocument> {
    const match = await this.requireMatch(id);
    this.assertHost(match, userId);

    const {
      location,
      turf: turfId,
      closingTime,
      eventStartsAt,
      eventEndsAt,
      // joinMode,
      status,
      ...scalarPatch
    } = dto;

    Object.assign(match, omitEmpty(scalarPatch));

    if (turfId !== undefined) {
      match.turf = new Types.ObjectId(turfId);
    }

    // if (joinMode !== undefined) {
    //   if (
    //     joinMode === LocalMatchJoinMode.OPEN &&
    //     match.visibility === LocalMatchVisibility.PRIVATE
    //   ) {
    //     throw new BadRequestException(
    //       'Private matches cannot use open join mode',
    //     );
    //   }
    //   match.joinMode = joinMode as LocalMatchJoinMode;
    // }

    if (closingTime !== undefined) {
      match.closingTime = new Date(closingTime);
    }
    if (eventStartsAt !== undefined) {
      match.eventStartsAt = new Date(eventStartsAt);
    }
    if (eventEndsAt !== undefined) {
      match.eventEndsAt =  new Date(eventEndsAt);
    }
    if (status !== undefined) {
      match.status = status as LocalMatchStatus;
    }

    if (location) {
      if (location.address !== undefined) {
        match.location.address = location.address;
      }
      if (location.coordinates !== undefined) {
        match.location.coordinates = location.coordinates as GeoPoint;
      }
    } else if (turfId !== undefined) {
      const turf = await this.turfService.findById(turfId);
      match.location = this.localMatchLocationFromTurf(turf);
    }

    this.syncFullStatus(match);
    await match.save();
    return (await match.populate(
      LocalMatchService.populate,
    )) as LocalMatchDocument;
  }

  async delete(id: string, userId: string): Promise<void> {
    const match = await this.requireMatch(id);
    if (match.createdBy.toString() !== userId) {
      throw new ForbiddenException('Only the creator can delete this match');
    }
    await this.localMatchModel.findByIdAndDelete(id);
  }

  async join(matchId: string, userId: string): Promise<LocalMatchDocument> {
    const match = await this.requireMatch(matchId);

    if (this.isMember(match, userId)) {
      throw new ConflictException('You are already in this match');
    }

    this.assertJoinWindow(match);

    if (match.visibility === LocalMatchVisibility.PRIVATE) {
      const allowed = await this.connectionsService.isConnectedToAny(
        userId,
        match.hostIds,
      );
      if (!allowed) {
        throw new ForbiddenException(
          'Only users connected to a host can join private matches',
        );
      }
    }

    const effectiveOpen =
      match.visibility === LocalMatchVisibility.PUBLIC &&
      match.joinMode === LocalMatchJoinMode.OPEN;

    if (effectiveOpen) {
      return this.addMemberAndSave(match, userId);
    }

    const pendingCount = match.joinRequests.filter(
      (r) => r.status === JoinRequestStatus.PENDING,
    ).length;

    if (pendingCount >= match.maxPendingJoinRequests) {
      throw new ConflictException(
        'This match is not accepting more join requests',
      );
    }

    const existingPending = match.joinRequests.find(
      (r) =>
        r.user.toString() === userId && r.status === JoinRequestStatus.PENDING,
    );
    if (existingPending) {
      throw new ConflictException('You already have a pending request');
    }

    match.joinRequests.push({
      user: new Types.ObjectId(userId),
      status: JoinRequestStatus.PENDING,
      createdAt: new Date(),
    });

    await match.save();
    return (await match.populate(
      LocalMatchService.populate,
    )) as LocalMatchDocument;
  }

  async acceptJoinRequest(
    matchId: string,
    requestId: string,
    hostUserId: string,
  ): Promise<LocalMatchDocument> {
    const match = await this.requireMatch(matchId);
    this.assertHost(match, hostUserId);

    const jr = this.findJoinRequest(match, requestId);
    if (!jr) {
      throw new NotFoundException('Join request not found');
    }
    if (jr.status !== JoinRequestStatus.PENDING) {
      throw new BadRequestException('Request is not pending');
    }

    if (match.members.length >= match.maxMembers) {
      throw new ConflictException('Match is full');
    }

    jr.status = JoinRequestStatus.ACCEPTED;
    jr.reviewedBy = new Types.ObjectId(hostUserId);
    jr.reviewedAt = new Date();

    match.members.push({
      user: jr.user,
      joinedAt: new Date(),
    });

    this.syncFullStatus(match);
    await match.save();
    return (await match.populate(
      LocalMatchService.populate,
    )) as LocalMatchDocument;
  }

  async rejectJoinRequest(
    matchId: string,
    requestId: string,
    hostUserId: string,
  ): Promise<LocalMatchDocument> {
    const match = await this.requireMatch(matchId);
    this.assertHost(match, hostUserId);

    const jr = this.findJoinRequest(match, requestId);
    if (!jr) {
      throw new NotFoundException('Join request not found');
    }
    if (jr.status !== JoinRequestStatus.PENDING) {
      throw new BadRequestException('Request is not pending');
    }

    jr.status = JoinRequestStatus.REJECTED;
    jr.reviewedBy = new Types.ObjectId(hostUserId);
    jr.reviewedAt = new Date();

    await match.save();
    return (await match.populate(
      LocalMatchService.populate,
    )) as LocalMatchDocument;
  }

  async promoteHost(
    matchId: string,
    hostUserId: string,
    dto: PromoteHostDto,
  ): Promise<LocalMatchDocument> {
    const match = await this.requireMatch(matchId);
    this.assertHost(match, hostUserId);

    const targetId = dto.userId;
    if (!this.isMember(match, targetId)) {
      throw new BadRequestException(
        'User must be a member before becoming a host',
      );
    }

    if (match.hostIds.some((h) => h.toString() === targetId)) {
      throw new ConflictException('User is already a host');
    }

    match.hostIds.push(new Types.ObjectId(targetId));
    await match.save();
    return (await match.populate(
      LocalMatchService.populate,
    )) as LocalMatchDocument;
  }

  async demoteHost(
    matchId: string,
    hostUserId: string,
    targetUserId: string,
  ): Promise<LocalMatchDocument> {
    const match = await this.requireMatch(matchId);
    this.assertHost(match, hostUserId);

    if (targetUserId === match.createdBy.toString()) {
      throw new ForbiddenException(
        'Cannot remove the original creator as host',
      );
    }

    const idx = match.hostIds.findIndex((h) => h.toString() === targetUserId);
    if (idx === -1) {
      throw new NotFoundException('User is not a host');
    }

    match.hostIds.splice(idx, 1);
    if (match.hostIds.length === 0) {
      throw new BadRequestException('Match must keep at least one host');
    }

    await match.save();
    return (await match.populate(
      LocalMatchService.populate,
    )) as LocalMatchDocument;
  }

  async leave(matchId: string, userId: string): Promise<void> {
    const match = await this.requireMatch(matchId);

    if (!this.isMember(match, userId)) {
      throw new BadRequestException('You are not a member of this match');
    }

    const isHost = match.hostIds.some((h) => h.toString() === userId);

    if (isHost && match.hostIds.length === 1) {
      throw new ForbiddenException(
        'You are the only host; promote another member or cancel the match',
      );
    }

    if (isHost) {
      match.hostIds = match.hostIds.filter((h) => h.toString() !== userId);
    }

    match.members = match.members.filter((m) => m.user.toString() !== userId);

    this.syncFullStatus(match);
    await match.save();
  }

  private async addMemberAndSave(
    match: LocalMatchDocument,
    userId: string,
  ): Promise<LocalMatchDocument> {
    if (match.members.length >= match.maxMembers) {
      throw new ConflictException('Match is full');
    }

    match.members.push({
      user: new Types.ObjectId(userId),
      joinedAt: new Date(),
    });

    this.syncFullStatus(match);
    await match.save();
    return (await match.populate(
      LocalMatchService.populate,
    )) as LocalMatchDocument;
  }

  private syncFullStatus(match: LocalMatchDocument): void {
    if (match.status === LocalMatchStatus.CANCELLED) {
      return;
    }
    if (match.status === LocalMatchStatus.COMPLETED) {
      return;
    }
    if (match.members.length >= match.maxMembers) {
      match.status = LocalMatchStatus.FULL;
    } else if (match.status === LocalMatchStatus.FULL) {
      match.status = LocalMatchStatus.OPEN;
    }
  }

  private async requireMatch(id: string): Promise<LocalMatchDocument> {
    const match = await this.localMatchModel.findById(id);
    if (!match) {
      throw new NotFoundException('Local match not found');
    }
    return match;
  }

  private assertCanView(match: LocalMatchDocument, viewerId: string): void {
    if (match.visibility === LocalMatchVisibility.PUBLIC) {
      return;
    }
    if (this.isHost(match, viewerId) || this.isMember(match, viewerId)) {
      return;
    }
    throw new ForbiddenException('You cannot view this private match');
  }

  private assertHost(match: LocalMatchDocument, userId: string): void {
    if (!this.isHost(match, userId)) {
      throw new ForbiddenException('Only hosts can perform this action');
    }
  }

  private isHost(match: LocalMatchDocument, userId: string): boolean {
    return match.hostIds.some((h) => h.toString() === userId);
  }

  private isMember(match: LocalMatchDocument, userId: string): boolean {
    return match.members.some((m) => m.user.toString() === userId);
  }

  private findJoinRequest(
    match: LocalMatchDocument,
    requestId: string,
  ): JoinRequestEntry | undefined {
    return match.joinRequests.find((r) => r._id?.toString() === requestId);
  }

  private localMatchLocationFromTurf(turf: TurfDocument): LocalMatchLocation {
    const lat = turf.location.coordinates?.lat;
    const lng = turf.location.coordinates?.lng;
    if (lat === undefined || lng === undefined) {
      throw new BadRequestException(
        'Selected turf has no coordinates; set them on the turf or send an explicit location',
      );
    }
    return {
      address: turf.location.address,
      coordinates: { type: 'Point', coordinates: [lng, lat] },
    };
  }

  private assertJoinWindow(match: LocalMatchDocument): void {
    if (match.status === LocalMatchStatus.CANCELLED) {
      throw new BadRequestException('This match was cancelled');
    }
    if (match.status === LocalMatchStatus.COMPLETED) {
      throw new BadRequestException('This match is completed');
    }
    if (match.status === LocalMatchStatus.FULL) {
      throw new ConflictException('This match is full');
    }
    if (new Date() > match.closingTime) {
      throw new BadRequestException(
        'The join window for this match has closed',
      );
    }
  }
}
