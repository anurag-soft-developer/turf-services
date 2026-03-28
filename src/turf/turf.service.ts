import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, PopulateOptions, QueryFilter } from 'mongoose';
import { Turf, TurfDocument } from './schemas/turf.schema';
import { CreateTurfDto, UpdateTurfDto } from './dto/turf.dto';
import { SearchTurfDto } from './dto/turf.filter.dto';
import { ITurf } from './interfaces/turf.interface';
import { PaginatedResult } from '../common/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';

@Injectable()
export class TurfService {
  static populateOptions: PopulateOptions[] = [
    {
      path: 'postedBy',
      select: userSelectFields,
    },
  ];

  constructor(@InjectModel(Turf.name) private turfModel: Model<Turf>) {}

  async create(
    postedBy: string,
    createTurfDto: CreateTurfDto,
  ): Promise<TurfDocument> {
    const existingTurf = await this.turfModel
      .findOne({ name: createTurfDto.name })
      .exec();

    if (existingTurf) {
      throw new ConflictException('Turf with this name already exists');
    }

    const turf = new this.turfModel({ ...createTurfDto, postedBy });
    return await (await turf.save()).populate(TurfService.populateOptions);
  }

  async findById(id: string): Promise<TurfDocument> {
    const turf = await this.turfModel
      .findById(id)
      .populate(TurfService.populateOptions)
      .exec();
    if (!turf) {
      throw new NotFoundException('Turf not found');
    }
    return turf;
  }

  async update(
    id: string,
    updateTurfDto: UpdateTurfDto,
  ): Promise<TurfDocument> {
    if (updateTurfDto.name) {
      const existingTurf = await this.turfModel
        .findOne({ name: updateTurfDto.name, _id: { $ne: id } })

        .exec();

      if (existingTurf) {
        throw new ConflictException('Turf with this name already exists');
      }
    }

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

    return turf;
  }

  async delete(id: string): Promise<void> {
    const result = await this.turfModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Turf not found');
    }
  }

  async getStats() {
    const totalTurfs = await this.turfModel.countDocuments();
    const availableTurfs = await this.turfModel.countDocuments({
      isAvailable: true,
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
      sportTypeStats,
      averagePrice: averagePrice[0]?.avgPrice || 0,
    };
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
      page = 1,
      limit = 10,
      sort,
    } = searchDto;

    // Build the query
    const query: QueryFilter<ITurf> = {};

    if (postedBy) {
      query.postedBy = postedBy.toString();
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
    if (location?.lat && location?.lng) {
      geoNearStage = {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [location.lng, location.lat], // MongoDB expects [longitude, latitude]
          },
          distanceField: 'distance',
          maxDistance: (location.radius || 10) * 1000, // Convert km to meters
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
    const sortOptions = this.buildSortOptions(sort);
    if (Object.keys(sortOptions).length > 0) {
      pipeline.push({ $sort: sortOptions });
    }

    // Add population for postedBy field
    pipeline.push({
      $addFields: {
        postedByObjectId: { $toObjectId: '$postedBy' }
      }
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
            else: null
          }
        }
      }
    });

    // Remove the temporary ObjectId field
    pipeline.push({
      $unset: 'postedByObjectId'
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

  private buildSortOptions(sortString?: string): Record<string, 1 | -1> {
    const sortOptions: Record<string, 1 | -1> = {};

    if (!sortString) {
      // Default sorting by createdAt desc
      sortOptions.createdAt = -1;
      return sortOptions;
    }

    const sortFields = sortString.split(',');

    for (const field of sortFields) {
      const [fieldName, order] = field.split(':');

      if (fieldName && order) {
        // Map field names to actual MongoDB fields
        const mappedField = this.mapSortField(fieldName);
        sortOptions[mappedField] = order.toLowerCase() === 'asc' ? 1 : -1;
      }
    }

    return sortOptions;
  }

  private mapSortField(field: string): string {
    const fieldMap: Record<string, string> = {
      price: 'pricing.basePricePerHour',
      name: 'name',
      createdAt: 'createdAt',
      distance: 'distance', // For location-based sorting
    };

    return fieldMap[field] || field;
  }
}
