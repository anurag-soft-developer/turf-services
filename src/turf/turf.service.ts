import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { QueryFilter } from 'mongoose';
import { Model, PipelineStage, PopulateOptions, Types } from 'mongoose';
import { Turf, TurfDocument } from './schemas/turf.schema';
import { CreateTurfDto, UpdateTurfDto } from './dto/turf.dto';
import { SearchTurfDto } from './dto/turf.filter.dto';
import { ITurf } from './interfaces/turf.interface';
import { TurfStatus } from './schemas/turf.schema';
import { PaginatedResult } from '../core/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';
import { buildMongoSortOptions } from '../core/utils/mongo-sort.util';
import { resolveId } from '../core/utils/mongo-ref.util';
import { UsersService } from '../users/users.service';
import { StorageLifecycleService } from '../storage/storage-lifecycle.service';
import { UserRole } from '../auth/decorators/roles.decorator';

const TURF_SEARCH_SORT_FIELD_MAP: Record<string, string> = {
  price: 'pricing.basePricePerHour',
  name: 'name',
  createdAt: 'createdAt',
  distance: 'distance',
};

export interface TurfViewer {
  userId: string;
  role: UserRole;
}

@Injectable()
export class TurfService {
  static populateOptions: PopulateOptions[] = [
    {
      path: 'postedBy',
      select: userSelectFields,
    },
  ];

  constructor(
    @InjectModel(Turf.name) private turfModel: Model<Turf>,
    private readonly usersService: UsersService,
    private readonly storageLifecycle: StorageLifecycleService,
  ) {}

  async create(
    postedBy: string,
    createTurfDto: CreateTurfDto,
  ): Promise<TurfDocument> {
    const owner = await this.usersService.findById(postedBy);
    if (!owner) {
      throw new NotFoundException('User not found');
    }

    const existingTurf = await this.turfModel
      .findOne({ name: createTurfDto.name })
      .exec();

    if (existingTurf) {
      throw new ConflictException('Turf with this name already exists');
    }

    const turf = new this.turfModel({ ...createTurfDto, postedBy });
    const saved = await (await turf.save()).populate(TurfService.populateOptions);

    await this.storageLifecycle.syncUrlArrayOnEntitySave({
      userId: postedBy,
      entityType: 'turf',
      entityId: saved._id.toString(),
      previousUrls: [],
      nextUrls: createTurfDto.images ?? [],
    });

    return saved;
  }

  async findById(id: string, viewer?: TurfViewer): Promise<TurfDocument> {
    const turf = await this.turfModel
      .findById(id)
      .populate(TurfService.populateOptions)
      .exec();
    if (!turf) {
      throw new NotFoundException('Turf not found');
    }

    if (viewer && !this.canViewTurf(turf, viewer)) {
      throw new NotFoundException('Turf not found');
    }

    if (!viewer && turf.status !== TurfStatus.PUBLISHED) {
      throw new NotFoundException('Turf not found');
    }

    return turf;
  }

  canViewTurf(turf: TurfDocument, viewer: TurfViewer): boolean {
    if (turf.status === TurfStatus.PUBLISHED) {
      return true;
    }
    if (viewer.role === UserRole.PLATFORM_ADMIN) {
      return true;
    }
    return resolveId(turf.postedBy) === resolveId(viewer.userId);
  }

  async update(
    id: string,
    updateTurfDto: UpdateTurfDto,
    viewer: TurfViewer,
  ): Promise<TurfDocument> {
    const existing = await this.turfModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('Turf not found');
    }
    this.assertOwnerOrAdmin(existing, viewer);

    if (updateTurfDto.name) {
      const nameConflict = await this.turfModel
        .findOne({ name: updateTurfDto.name, _id: { $ne: id } })
        .exec();

      if (nameConflict) {
        throw new ConflictException('Turf with this name already exists');
      }
    }

    const previousImages = existing.images ?? [];

    const turf = await this.turfModel
      .findByIdAndUpdate(id, updateTurfDto, {
        new: true,
        runValidators: true,
      })
      .populate(TurfService.populateOptions)
      .exec();

    if (!turf) {
      throw new NotFoundException('Turf not found');
    }

    if (updateTurfDto.images !== undefined) {
      await this.storageLifecycle.syncUrlArrayOnEntitySave({
        userId: viewer.userId,
        entityType: 'turf',
        entityId: turf._id.toString(),
        previousUrls: previousImages,
        nextUrls: updateTurfDto.images ?? [],
      });
    }

    return turf;
  }

  async delete(id: string, viewer: TurfViewer): Promise<void> {
    const existing = await this.turfModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('Turf not found');
    }
    this.assertOwnerOrAdmin(existing, viewer);

    const result = await this.turfModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Turf not found');
    }

    await this.storageLifecycle.deleteUrlsForUser(
      existing.postedBy.toString(),
      existing.images ?? [],
    );
  }

  async getStats() {
    const totalTurfs = await this.turfModel.countDocuments();
    const availableTurfs = await this.turfModel.countDocuments({
      isAvailable: true,
    });
    const publishedTurfs = await this.turfModel.countDocuments({
      status: TurfStatus.PUBLISHED,
    });
    const pendingApprovalTurfs = await this.turfModel.countDocuments({
      status: TurfStatus.PENDING_APPROVAL,
    });
    const sportTypeStats = await this.turfModel.aggregate([
      {
        $group: {
          _id: '$sportType',
          count: { $sum: 1 },
        },
      },
    ]);

    const averagePrice = await this.turfModel.aggregate([
      {
        $group: {
          _id: null,
          avgPrice: { $avg: '$pricing.basePricePerHour' },
        },
      },
    ]);

    return {
      totalTurfs,
      availableTurfs,
      unavailableTurfs: totalTurfs - availableTurfs,
      publishedTurfs,
      pendingApprovalTurfs,
      sportTypeStats,
      averagePrice: averagePrice[0]?.avgPrice || 0,
    };
  }

  searchFeedTurfs(searchDto: SearchTurfDto): Promise<PaginatedResult<ITurf>> {
    const { status: _status, isAvailable: _isAvailable, ...rest } = searchDto;
    return this.searchTurfs({
      ...rest,
      status: TurfStatus.PUBLISHED,
      isAvailable: true,
    });
  }

  async searchTurfs(searchDto: SearchTurfDto): Promise<PaginatedResult<ITurf>> {
    const {
      globalSearchText,
      sportTypes,
      amenities,
      location,
      pricing,
      isAvailable,
      operatingTime,
      postedBy,
      status,
      page = 1,
      limit = 10,
      sort,
    } = searchDto;

    // PipelineStage.Match['$match'] is QueryFilter<any>; QueryFilter<unknown> is the same loose branch without `any`.
    // Intersect with QueryFilter<ITurf> for path completion (postedBy, nested paths, etc.).
    const query: QueryFilter<ITurf> & QueryFilter<unknown> = {};

    if (postedBy) {
      query.postedBy = new Types.ObjectId(postedBy);
    }

    if (status) {
      query.status = status;
    }

    if (globalSearchText) {
      const searchRegex = new RegExp(globalSearchText, 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { sportType: { $in: [searchRegex] } },
        { amenities: { $in: [searchRegex] } },
        { 'location.address': searchRegex },
      ];
    }

    if (sportTypes && sportTypes.length > 0) {
      query.sportType = { $in: sportTypes };
    }

    if (amenities && amenities.length > 0) {
      query.amenities = { $all: amenities };
    }

    if (isAvailable !== undefined) {
      query.isAvailable = isAvailable;
    }

    if (pricing) {
      query['pricing.basePricePerHour'] = {};

      if (pricing.minPrice !== undefined) {
        query['pricing.basePricePerHour'].$gte = pricing.minPrice;
      }

      if (pricing.maxPrice !== undefined) {
        query['pricing.basePricePerHour'].$lte = pricing.maxPrice;
      }

      // If no price range specified, remove the empty object
      if (Object.keys(query['pricing.basePricePerHour']).length === 0) {
        delete query['pricing.basePricePerHour'];
      }
    }

    // Location-based search (using geospatial query)
    let geoNearStage: PipelineStage | null = null;
    if (
      location?.nearbyLat !== undefined &&
      location?.nearbyLng !== undefined
    ) {
      geoNearStage = {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [location.nearbyLng, location.nearbyLat],
          },
          distanceField: 'distance',
          maxDistance: (location.nearbyRadiusKm ?? 100) * 1000,
          spherical: true,
          query: query, // Apply other filters here
        },
      };
    }

    // Operating hours filter
    if (operatingTime) {
      query['operatingHours.open'] = { $lte: operatingTime };
      query['operatingHours.close'] = { $gte: operatingTime };
    }

    // Build aggregation pipeline
    const pipeline: PipelineStage[] = [];

    // If location search, use $geoNear as first stage
    if (geoNearStage) {
      pipeline.push(geoNearStage);
    } else {
      // Otherwise, use $match
      pipeline.push({ $match: query });
    }

    // Add sorting
    const sortOptions = buildMongoSortOptions(sort, {
      defaultSort: { createdAt: -1 },
      fieldMap: TURF_SEARCH_SORT_FIELD_MAP,
      whenParsedEmpty: 'none',
    });
    if (Object.keys(sortOptions).length > 0) {
      pipeline.push({ $sort: sortOptions });
    }

    // Add population for postedBy field
    pipeline.push({
      $addFields: {
        postedByObjectId: { $toObjectId: '$postedBy' },
      },
    });

    pipeline.push({
      $lookup: {
        from: 'users', // Collection name in MongoDB (lowercase and pluralized)
        localField: 'postedByObjectId',
        foreignField: '_id',
        as: 'postedBy',
        pipeline: [
          {
            $project: userSelectFields.split(' ').reduce((acc, field) => {
              acc[field] = 1;
              return acc;
            }, {}),
          },
        ],
      },
    });

    // Convert postedBy array to single object and remove temporary field
    pipeline.push({
      $addFields: {
        postedBy: {
          $cond: {
            if: { $gt: [{ $size: '$postedBy' }, 0] },
            then: { $arrayElemAt: ['$postedBy', 0] },
            else: null,
          },
        },
      },
    });

    // Remove the temporary ObjectId field
    pipeline.push({
      $unset: 'postedByObjectId',
    });

    // // Add facet for pagination and total count
    pipeline.push({
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
      },
    });
    const results = await this.turfModel.aggregate(pipeline);

    const metadata = results[0]?.metadata[0] || { total: 0 };
    const data = results[0]?.data || [];

    return {
      data,
      totalDocuments: metadata.total,
      page,
      limit,
      totalPages: Math.ceil(metadata.total / limit),
    };
  }

  private assertOwnerOrAdmin(turf: TurfDocument, viewer: TurfViewer): void {
    const isOwner = resolveId(turf.postedBy) === resolveId(viewer.userId);
    const isAdmin = viewer.role === UserRole.PLATFORM_ADMIN;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to modify this turf',
      );
    }
  }
}
