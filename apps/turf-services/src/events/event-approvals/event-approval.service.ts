import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Event, EventDocument } from '../schemas/event.schema';
import { EventStatus } from '../interfaces/event.interface';
import { EventStatusUtility } from '../utility/event-status.utility';
import { ReviewEventDto } from './dto/event-approval.dto';
import { SearchEventDto } from '../dto/events.dto';
import { EventsService } from '../events.service';
import { PaginatedResult } from '../../core/interfaces/common';
import { resolveId } from '../../core/utils/mongo-ref.util';
import { IEvent } from '../interfaces/event.interface';

@Injectable()
export class EventApprovalService {
  constructor(
    @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
    private readonly eventsService: EventsService,
  ) {}

  async submitForApproval(
    eventId: string,
    organizerId: string,
  ): Promise<EventDocument> {
    const event = await this.loadEventForOrganizer(eventId, organizerId);

    EventStatusUtility.validateTransition(
      event.status,
      EventStatus.PENDING_APPROVAL,
    );

    event.status = EventStatus.PENDING_APPROVAL;
    event.rejectionReason = undefined;
    event.submittedAt = new Date();

    return (await event.save()).populate(EventsService.populateOptions);
  }

  async withdrawSubmission(
    eventId: string,
    organizerId: string,
  ): Promise<EventDocument> {
    const event = await this.loadEventForOrganizer(eventId, organizerId);

    EventStatusUtility.validateTransition(event.status, EventStatus.DRAFT);

    event.status = EventStatus.DRAFT;
    event.submittedAt = undefined;

    return (await event.save()).populate(EventsService.populateOptions);
  }

  async reviewEvent(
    eventId: string,
    adminId: string,
    dto: ReviewEventDto,
  ): Promise<EventDocument> {
    const event = await this.loadEventForReview(eventId);

    const nextStatus =
      dto.action === 'publish' ? EventStatus.PUBLISHED : EventStatus.REJECTED;

    EventStatusUtility.validateTransition(event.status, nextStatus);

    event.status = nextStatus;
    event.reviewedAt = new Date();
    event.reviewedBy = new Types.ObjectId(adminId);

    if (dto.action === 'reject') {
      event.rejectionReason = dto.rejectionReason!.trim();
    } else {
      event.rejectionReason = undefined;
    }

    return (await event.save()).populate(EventsService.populateOptions);
  }

  async listPendingForAdmin(
    filter: SearchEventDto,
  ): Promise<PaginatedResult<IEvent>> {
    return this.eventsService.searchEvents({
      ...filter,
      status: EventStatus.PENDING_APPROVAL,
    });
  }

  private async loadEventForOrganizer(
    eventId: string,
    organizerId: string,
  ): Promise<EventDocument> {
    const event = await this.eventModel.findById(eventId).exec();
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (resolveId(event.createdBy) !== resolveId(organizerId)) {
      throw new ForbiddenException('You do not own this event');
    }
    return event;
  }

  private async loadEventForReview(eventId: string): Promise<EventDocument> {
    const event = await this.eventModel.findById(eventId).exec();
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (event.status !== EventStatus.PENDING_APPROVAL) {
      throw new ForbiddenException(
        'Only events pending approval can be reviewed',
      );
    }
    return event;
  }
}
