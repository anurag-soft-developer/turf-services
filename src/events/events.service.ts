import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, PopulateOptions, Types } from 'mongoose';
import { Event, EventDocument } from './schemas/event.schema';
import { CreateEventDto, SearchEventDto, UpdateEventDto } from './dto/events.dto';
import { EventStatus, IEvent } from './interfaces/event.interface';
import { PaginatedResult } from '../core/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';
import { buildMongoSortOptions } from '../core/utils/mongo-sort.util';
import { UsersService } from '../users/users.service';
import { UserRole } from '../auth/decorators/roles.decorator';
import { EventSlugUtility } from './utility/event-slug.utility';
import { EventBookingService } from '../event-booking/event-booking.service';

export interface EventViewer {
  userId: string;
  role: UserRole;
}

const EVENT_SEARCH_SORT_FIELD_MAP: Record<string, string> = {
  eventDate: 'eventDate',
  price: 'price',
  distance: 'distance',
  createdAt: 'createdAt',
};

@Injectable()
export class EventsService {
  static populateOptions: PopulateOptions[] = [
    {
      path: 'createdBy',
      select: userSelectFields,
    },
    {
      path: 'turf',
      select: '_id name location images',
    },
  ];

  constructor(
    @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => EventBookingService))
    private readonly eventBookingService: EventBookingService,
  ) {}

  async create(
    createdBy: string,
    dto: CreateEventDto,
  ): Promise<EventDocument> {
    const owner = await this.usersService.findById(createdBy);
    if (!owner) {
      throw new NotFoundException('User not found');
    }

    const slug = await this.ensureUniqueSlug(dto.title);

    const event = new this.eventModel({
      ...dto,
      eventDate: new Date(dto.eventDate),
      createdBy,
      slug,
      status: EventStatus.DRAFT,
      registeredCount: 0,
      isClosed: false,
      archive: false,
      currency: dto.currency ?? 'INR',
    });

    return (await event.save()).populate(EventsService.populateOptions);
  }

  async findMine(
    userId: string,
    filter: SearchEventDto,
  ): Promise<PaginatedResult<IEvent>> {
    return this.searchEvents({ ...filter, createdBy: userId });
  }

  async findMineStats(userId: string) {
    const [stats] = await this.eventModel.aggregate([
      {
        $match: {
          createdBy: new Types.ObjectId(userId),
          archive: false,
        },
      },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          draftCount: {
            $sum: {
              $cond: [{ $eq: ['$status', EventStatus.DRAFT] }, 1, 0],
            },
          },
          pendingApprovalCount: {
            $sum: {
              $cond: [{ $eq: ['$status', EventStatus.PENDING_APPROVAL] }, 1, 0],
            },
          },
          publishedCount: {
            $sum: {
              $cond: [{ $eq: ['$status', EventStatus.PUBLISHED] }, 1, 0],
            },
          },
          rejectedCount: {
            $sum: {
              $cond: [{ $eq: ['$status', EventStatus.REJECTED] }, 1, 0],
            },
          },
          closedCount: {
            $sum: {
              $cond: [{ $eq: ['$status', EventStatus.CLOSED] }, 1, 0],
            },
          },
          totalRegistrations: { $sum: '$registeredCount' },
        },
      },
      {
        $project: {
          _id: 0,
          totalEvents: 1,
          draftCount: 1,
          pendingApprovalCount: 1,
          publishedCount: 1,
          rejectedCount: 1,
          closedCount: 1,
          totalRegistrations: 1,
        },
      },
    ]);

    return (
      stats ?? {
        totalEvents: 0,
        draftCount: 0,
        pendingApprovalCount: 0,
        publishedCount: 0,
        rejectedCount: 0,
        closedCount: 0,
        totalRegistrations: 0,
      }
    );
  }

  async findPublic(filter: SearchEventDto): Promise<PaginatedResult<IEvent>> {
    return this.searchEvents(
      { ...filter, status: EventStatus.PUBLISHED },
      { publicFeed: true },
    );
  }

  async findPublicBySlug(slug: string): Promise<EventDocument> {
    const event = await this.eventModel
      .findOne({
        slug,
        status: EventStatus.PUBLISHED,
        archive: false,
        isClosed: false,
      })
      .populate(EventsService.populateOptions)
      .exec();

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  async findById(id: string, viewer?: EventViewer): Promise<EventDocument> {
    const event = await this.eventModel
      .findById(id)
      .populate(EventsService.populateOptions)
      .exec();

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (viewer && !this.canViewEvent(event, viewer)) {
      throw new NotFoundException('Event not found');
    }

    if (!viewer && event.status !== EventStatus.PUBLISHED) {
      throw new NotFoundException('Event not found');
    }

    if (!viewer && (event.archive || event.isClosed)) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  canViewEvent(event: EventDocument, viewer: EventViewer): boolean {
    if (
      event.status === EventStatus.PUBLISHED &&
      !event.archive &&
      !event.isClosed
    ) {
      return true;
    }
    if (viewer.role === UserRole.PLATFORM_ADMIN) {
      return true;
    }
    return event.createdBy.toString() === viewer.userId;
  }

  async update(
    id: string,
    dto: UpdateEventDto,
    viewer: EventViewer,
  ): Promise<EventDocument> {
    const existing = await this.eventModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('Event not found');
    }
    this.assertOrganizerOrAdmin(existing, viewer);

    if (dto.title && dto.title !== existing.title) {
      existing.slug = await this.ensureUniqueSlug(dto.title, id);
    }

    const patch: Record<string, unknown> = { ...dto };
    if (dto.eventDate) {
      patch.eventDate = new Date(dto.eventDate);
    }
    if (dto.location) {
      if (dto.location.address) {
        existing.location.address = dto.location.address;
      }
      if (dto.location.coordinates) {
        existing.location.coordinates = dto.location.coordinates;
      }
      delete patch.location;
    }

    Object.assign(existing, patch);
    return (await existing.save()).populate(EventsService.populateOptions);
  }

  async delete(id: string, viewer: EventViewer): Promise<void> {
    const existing = await this.eventModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('Event not found');
    }
    this.assertOrganizerOrAdmin(existing, viewer);

    const result = await this.eventModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Event not found');
    }
  }

  async closeEvent(id: string, viewer: EventViewer): Promise<EventDocument> {
    const event = await this.eventModel.findById(id).exec();
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    this.assertOrganizerOrAdmin(event, viewer);

    if (event.isClosed || event.status === EventStatus.CLOSED) {
      throw new ConflictException('Event is already closed');
    }

    if (event.status !== EventStatus.PUBLISHED) {
      throw new ForbiddenException('Only published events can be closed');
    }

    event.status = EventStatus.CLOSED;
    event.isClosed = true;
    event.closedAt = new Date();
    event.registrationsPaused = true;

    await event.save();
    await this.eventBookingService.releaseEscrowForClosedEvent(id);

    return (await event.populate(
      EventsService.populateOptions,
    )) as EventDocument;
  }

  async searchEvents(
    searchDto: SearchEventDto,
    options: { publicFeed?: boolean } = {},
  ){
    const {
      location,
      page = 1,
      limit = 10,
      sortBy,
      sortOrder = 'asc',
    } = searchDto;

    const query = this.buildEventSearchQuery(searchDto, options);
    const skip = (page - 1) * limit;
    const nearbyLat = location?.nearbyLat;
    const nearbyLng = location?.nearbyLng;

    if (nearbyLat !== undefined && nearbyLng !== undefined) {
      return this.searchEventsNearLocation({
        query,
        nearbyLat,
        nearbyLng,
        nearbyRadiusKm: location?.nearbyRadiusKm ?? 100,
        sortBy,
        sortOrder,
        page,
        limit,
        skip,
      });
    }

    const sortField = sortBy
      ? `${sortBy}:${sortOrder}`
      : `eventDate:${sortOrder}`;
    const sort = buildMongoSortOptions(sortField, {
      defaultSort: { eventDate: 1 },
      fieldMap: EVENT_SEARCH_SORT_FIELD_MAP,
      whenParsedEmpty: 'default',
    });

    const [data, totalDocuments] = await Promise.all([
      this.eventModel
        .find(query)
        .populate(EventsService.populateOptions)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.eventModel.countDocuments(query),
    ]);

    return {
      data: data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  private buildEventSearchQuery(
    searchDto: SearchEventDto,
    options: { publicFeed?: boolean } = {},
  ): Record<string, unknown> {
    const { globalSearchText, createdBy, status, minPrice, maxPrice } =
      searchDto;

    const query: Record<string, unknown> = { archive: false };
    if (options.publicFeed) {
      query.isClosed = false;
    }

    if (createdBy) {
      query.createdBy = new Types.ObjectId(createdBy);
    }
    if (status) {
      query.status = status;
    }
    if (globalSearchText) {
      const searchRegex = new RegExp(globalSearchText, 'i');
      query.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { 'location.address': searchRegex },
      ];
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined) {
        (query.price as { $gte?: number }).$gte = minPrice;
      }
      if (maxPrice !== undefined) {
        (query.price as { $lte?: number }).$lte = maxPrice;
      }
    }

    return query;
  }

  private async searchEventsNearLocation({
    query,
    nearbyLat,
    nearbyLng,
    nearbyRadiusKm,
    sortBy,
    sortOrder = 'asc',
    page,
    limit,
    skip,
  }: {
    query: Record<string, unknown>;
    nearbyLat: number;
    nearbyLng: number;
    nearbyRadiusKm: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page: number;
    limit: number;
    skip: number;
  }){
    const geoMatch = {
      ...query,
      'location.coordinates': { $exists: true, $ne: null },
    };

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
          query: geoMatch,
        },
      },
    ];

    if (sortBy) {
      const sortOptions = buildMongoSortOptions(`${sortBy}:${sortOrder}`, {
        defaultSort: { eventDate: 1 },
        fieldMap: EVENT_SEARCH_SORT_FIELD_MAP,
        whenParsedEmpty: 'none',
      });
      if (Object.keys(sortOptions).length > 0) {
        pipeline.push({ $sort: sortOptions });
      }
    }

    pipeline.push(...EventsService.buildPopulationStages());
    pipeline.push({
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    });

    const results = await this.eventModel.aggregate(pipeline);
    const metadata = results[0]?.metadata[0] || { total: 0 };
    const data = results[0]?.data || [];

    return {
      data: data,
      totalDocuments: metadata.total,
      page,
      limit,
      totalPages: Math.ceil(metadata.total / limit) || 0,
    };
  }

  private static buildPopulationStages(): PipelineStage[] {
    const userProject = userSelectFields.split(' ').reduce(
      (acc, field) => {
        acc[field] = 1;
        return acc;
      },
      {} as Record<string, 1>,
    );

    return [
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'createdBy',
          pipeline: [{ $project: userProject }],
        },
      },
      {
        $addFields: {
          createdBy: {
            $cond: {
              if: { $gt: [{ $size: '$createdBy' }, 0] },
              then: { $arrayElemAt: ['$createdBy', 0] },
              else: null,
            },
          },
        },
      },
      {
        $lookup: {
          from: 'turfs',
          localField: 'turf',
          foreignField: '_id',
          as: 'turf',
          pipeline: [
            {
              $project: {
                _id: 1,
                name: 1,
                location: 1,
                images: 1,
              },
            },
          ],
        },
      },
      {
        $addFields: {
          turf: {
            $cond: {
              if: { $gt: [{ $size: '$turf' }, 0] },
              then: { $arrayElemAt: ['$turf', 0] },
              else: null,
            },
          },
        },
      },
    ];
  }

  async getPublishedEventForBooking(eventId: string): Promise<EventDocument> {
    const event = await this.eventModel.findById(eventId).exec();
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (
      event.status !== EventStatus.PUBLISHED ||
      event.isClosed ||
      event.registrationsPaused ||
      event.archive
    ) {
      throw new ForbiddenException('Event is not open for registration');
    }
    return event;
  }

  async incrementRegisteredCount(eventId: string, delta: number): Promise<void> {
    await this.eventModel.findByIdAndUpdate(eventId, {
      $inc: { registeredCount: delta },
    });
  }

  private assertOrganizerOrAdmin(
    event: EventDocument,
    viewer: EventViewer,
  ): void {
    const isOrganizer = event.createdBy.toString() === viewer.userId;
    const isAdmin = viewer.role === UserRole.PLATFORM_ADMIN;
    if (!isOrganizer && !isAdmin) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async ensureUniqueSlug(
    title: string,
    excludeId?: string,
  ): Promise<string> {
    const base = EventSlugUtility.slugifyTitle(title) || 'event';
    let candidate = base;
    let attempt = 0;

    while (true) {
      const existing = await this.eventModel
        .findOne({
          slug: candidate,
          ...(excludeId ? { _id: { $ne: excludeId } } : {}),
        })
        .select('_id')
        .lean();

      if (!existing) {
        return candidate;
      }

      attempt += 1;
      candidate = EventSlugUtility.withSuffix(
        base,
        `${Date.now().toString(36)}${attempt}`,
      );
    }
  }
}
