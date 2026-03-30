import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PopulateOptions, QueryFilter, Types } from 'mongoose';
import { TurfReview, TurfReviewDocument } from './schemas/turf-review.schema';
import {
  Turf,
  TurfDocument,
  turfSelectFields,
} from '../turf/schemas/turf.schema';
import {
  CreateTurfReviewDto,
  UpdateTurfReviewDto,
  TurfReviewFilterDto,
  VoteReviewDto,
  ReportReviewDto,
  ModerateReviewDto,
} from './dto/turf-review.dto';
import { PaginatedResult } from '../common/interfaces/common';
import { userSelectFields } from '../users/schemas/user.schema';

@Injectable()
export class TurfReviewService {
  static populateOptions: PopulateOptions[] = [
    {
      path: 'reviewedBy',
      select: userSelectFields,
    },
    {
      path: 'turf',
      select: turfSelectFields,
    },
    {
      path: 'moderatedBy',
      select: userSelectFields,
    },
  ];
  constructor(
    @InjectModel(TurfReview.name)
    private turfReviewModel: Model<TurfReviewDocument>,
    @InjectModel(Turf.name)
    private turfModel: Model<TurfDocument>,
  ) {}

  async createReview(
    createReviewDto: CreateTurfReviewDto,
    userId: string,
  ): Promise<TurfReviewDocument> {
    const { turf } = createReviewDto;

    const turfDoc = await this.turfModel.findById(turf);
    if (!turfDoc) {
      throw new NotFoundException('Turf not found');
    }

    // Check if user already reviewed this turf
    const existingReview = await this.turfReviewModel.findOne({
      turf,
      reviewedBy: userId,
    });

    if (existingReview) {
      throw new ConflictException('You have already reviewed this turf');
    }

    // TODO: Check if user has a verified booking for this turf
    // This would require integration with booking system
    const isVerifiedBooking = false;

    const review = new this.turfReviewModel({
      ...createReviewDto,
      reviewedBy: userId,
      isVerifiedBooking,
    });

    const savedReview = await (
      await review.save()
    ).populate(TurfReviewService.populateOptions);

    await this.updateTurfRatingStats(turf);

    return savedReview;
  }

  async updateReview(
    reviewId: string,
    updateReviewDto: UpdateTurfReviewDto,
    userId: string,
  ): Promise<TurfReviewDocument> {
    const review = await this.turfReviewModel.findById(reviewId);
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    // Only allow the reviewer to update their own review
    if (review.reviewedBy.toString() !== userId) {
      throw new ForbiddenException('You can only update your own reviews');
    }

    const updateData = { ...updateReviewDto };

    Object.assign(review, updateData);

    const updatedReview = await (
      await review.save()
    ).populate(TurfReviewService.populateOptions);

    // Update turf's average rating if rating changed
    if (updateReviewDto.rating !== undefined) {
      await this.updateTurfRatingStats(review.turf.toString());
    }

    return updatedReview;
  }

  async findAll(filterDto: TurfReviewFilterDto) {
    const {
      turf,
      reviewedBy,
      rating,
      minRating,
      maxRating,
      isVerifiedBooking,
      isModerated,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filterDto;

    const filter: QueryFilter<TurfReviewDocument> = {};

    if (turf) filter.turf = turf;
    if (reviewedBy) filter.reviewedBy = reviewedBy;
    if (rating !== undefined) filter.rating = rating;
    if (minRating !== undefined || maxRating !== undefined) {
      filter.rating = {};
      if (minRating !== undefined) filter.rating.$gte = minRating;
      if (maxRating !== undefined) filter.rating.$lte = maxRating;
    }
    if (isVerifiedBooking !== undefined)
      filter.isVerifiedBooking = isVerifiedBooking;
    if (isModerated !== undefined) filter.isModerated = isModerated;

    // Date range filtering
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      this.turfReviewModel
        .find(filter)
        .populate(TurfReviewService.populateOptions)
        .sort({ [sortBy]: sortDirection })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.turfReviewModel.countDocuments(filter),
    ]);

    const result: PaginatedResult<TurfReviewDocument> & {
      averageRating?: number;
      ratingDistribution?: {
        [key: number]: number;
      };
    } = {
      data: reviews,
      totalDocuments: total,
      limit,
      page,
      totalPages: Math.ceil(total / limit),
    };

    // If filtering by turf, include aggregate statistics
    if (turf) {
      const stats = await this.getTurfReviewStats(turf);
      result.averageRating = stats.averageRating;
      result.ratingDistribution = stats.ratingDistribution;
    }

    return result;
  }

  async findById(id: string): Promise<TurfReviewDocument | null> {
    return await this.turfReviewModel
      .findById(id)
      .populate(TurfReviewService.populateOptions)
      .exec();
  }

  async findUserReviews(
    userId: string,
    filterDto: TurfReviewFilterDto,
  ) {
    const result = await this.findAll({ ...filterDto, reviewedBy: userId });
    return result;
  }

  async findTurfReviews(
    turfId: string,
    filterDto: TurfReviewFilterDto,
  ) {
    const result = await this.findAll({ ...filterDto, turf: turfId });
    return result;
  }

  async voteReview(
    reviewId: string,
    voteDto: VoteReviewDto,
    userId: string,
  ): Promise<TurfReviewDocument> {
    const review = await this.turfReviewModel.findById(reviewId);
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    // For simplicity, we'll just increment the vote count
    // In a production system, you'd want to track individual votes to prevent duplicates
    if (voteDto.helpful) {
      review.helpfulVotes += 1;
    } else {
      review.notHelpfulVotes += 1;
    }

    return await (
      await review.save()
    ).populate(TurfReviewService.populateOptions);
  }

  async reportReview(
    reviewId: string,
    reportDto: ReportReviewDto,
    userId: string,
  ): Promise<TurfReviewDocument> {
    const review = await this.turfReviewModel.findById(reviewId);
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    // Increment report count
    review.reportedCount += 1;

    // Auto-moderate if too many reports (example: 5 reports)
    if (review.reportedCount >= 5 && !review.isModerated) {
      review.isModerated = true;
      review.moderatedAt = new Date();
    }

    return await (
      await review.save()
    ).populate(TurfReviewService.populateOptions);
  }

  async moderateReview(
    reviewId: string,
    moderateDto: ModerateReviewDto,
    moderatorId: string,
  ): Promise<TurfReviewDocument> {
    const review = await this.turfReviewModel.findById(reviewId);
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    review.isModerated = moderateDto.isModerated;
    review.moderatedAt = new Date();
    review.moderatedBy = new Types.ObjectId(moderatorId);

    return await (
      await review.save()
    ).populate(TurfReviewService.populateOptions);
  }

  async deleteReview(id: string, userId: string): Promise<void> {
    const review = await this.turfReviewModel.findById(id);
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    // Only allow the reviewer to delete their own review
    if (review.reviewedBy.toString() !== userId) {
      throw new ForbiddenException('You can only delete your own reviews');
    }

    const turfId = review.turf.toString();
    await this.turfReviewModel.findByIdAndDelete(id);

    // Update turf's rating stats after deletion
    await this.updateTurfRatingStats(turfId);
  }

  async getTurfReviewStats(turfId: string): Promise<{
    averageRating: number;
    totalReviews: number;
    ratingDistribution: { [key: number]: number };
  }> {
    const stats = await this.turfReviewModel.aggregate([
      { $match: { turf: new Types.ObjectId(turfId), isModerated: false } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          ratings: { $push: '$rating' },
        },
      },
    ]);

    if (!stats.length) {
      return {
        averageRating: 0,
        totalReviews: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
    }

    const { averageRating, totalReviews, ratings } = stats[0];

    // Calculate rating distribution
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratings.forEach((rating: number) => {
      ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
    });

    return {
      averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
      totalReviews,
      ratingDistribution,
    };
  }

  private async updateTurfRatingStats(turfId: string): Promise<void> {
    const stats = await this.getTurfReviewStats(turfId);

    // Update the turf document with new stats
    await this.turfModel.findByIdAndUpdate(turfId, {
      $set: {
        averageRating: stats.averageRating,
        totalReviews: stats.totalReviews,
      },
    });
  }
}
