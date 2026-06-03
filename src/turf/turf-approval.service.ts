import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Turf, TurfDocument } from './schemas/turf.schema';
import { TurfStatus } from './schemas/turf.schema';
import { TurfStatusUtility } from './utility/turf-status.utility';
import { ReviewTurfDto } from './dto/turf-approval.dto';
import { SearchTurfDto } from './dto/turf.filter.dto';
import { TurfService } from './turf.service';
import { PaginatedResult } from '../core/interfaces/common';
import { ITurf } from './interfaces/turf.interface';

@Injectable()
export class TurfApprovalService {
  constructor(
    @InjectModel(Turf.name) private readonly turfModel: Model<Turf>,
    private readonly turfService: TurfService,
  ) {}

  async submitForApproval(
    turfId: string,
    ownerId: string,
  ): Promise<TurfDocument> {
    const turf = await this.loadTurfForOwner(turfId, ownerId);

    TurfStatusUtility.validateTransition(
      turf.status,
      TurfStatus.PENDING_APPROVAL,
    );

    turf.status = TurfStatus.PENDING_APPROVAL;
    turf.rejectionReason = undefined;
    turf.submittedAt = new Date();

    return (await turf.save()).populate(TurfService.populateOptions);
  }

  async withdrawSubmission(
    turfId: string,
    ownerId: string,
  ): Promise<TurfDocument> {
    const turf = await this.loadTurfForOwner(turfId, ownerId);

    TurfStatusUtility.validateTransition(turf.status, TurfStatus.DRAFT);

    turf.status = TurfStatus.DRAFT;
    turf.submittedAt = undefined;

    return (await turf.save()).populate(TurfService.populateOptions);
  }

  async reviewTurf(
    turfId: string,
    adminId: string,
    dto: ReviewTurfDto,
  ): Promise<TurfDocument> {
    const turf = await this.loadTurfForReview(turfId);

    const nextStatus =
      dto.action === 'publish' ? TurfStatus.PUBLISHED : TurfStatus.REJECTED;

    TurfStatusUtility.validateTransition(turf.status, nextStatus);

    turf.status = nextStatus;
    turf.reviewedAt = new Date();
    turf.reviewedBy = new Types.ObjectId(adminId);

    if (dto.action === 'reject') {
      turf.rejectionReason = dto.rejectionReason!.trim();
    } else {
      turf.rejectionReason = undefined;
    }

    return (await turf.save()).populate(TurfService.populateOptions);
  }

  async listPendingForAdmin(
    filter: SearchTurfDto,
  ): Promise<PaginatedResult<ITurf>> {
    return this.turfService.searchTurfs({
      ...filter,
      status: TurfStatus.PENDING_APPROVAL,
    });
  }

  private async loadTurfForOwner(
    turfId: string,
    ownerId: string,
  ): Promise<TurfDocument> {
    const turf = await this.turfModel.findById(turfId).exec();
    if (!turf) {
      throw new NotFoundException('Turf not found');
    }
    if (turf.postedBy.toString() !== ownerId.toString()) {
      throw new ForbiddenException('You do not own this turf');
    }
    return turf;
  }

  private async loadTurfForReview(turfId: string): Promise<TurfDocument> {
    const turf = await this.turfModel.findById(turfId).exec();
    if (!turf) {
      throw new NotFoundException('Turf not found');
    }
    if (turf.status !== TurfStatus.PENDING_APPROVAL) {
      throw new ForbiddenException(
        'Only turfs pending approval can be reviewed',
      );
    }
    return turf;
  }
}
