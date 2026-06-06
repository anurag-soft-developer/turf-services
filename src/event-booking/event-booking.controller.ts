import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EventBookingService } from './event-booking.service';
import {
  CreateEventBookingDto,
  EventBookingFilterDto,
  UpdateEventBookingDto,
  VerifyEventRazorpayPaymentDto,
  CheckEventCapacityDto,
} from './dto/event-booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as UserInterface from '../users/interfaces/user.interface';

@Controller('events/:eventId/bookings')
@UseGuards(JwtAuthGuard)
export class EventBookingController {
  constructor(private readonly eventBookingService: EventBookingService) {}

  @Post('create-order')
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @Param('eventId') eventId: string,
    @Body() dto: CreateEventBookingDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.createBookingOrder(eventId, dto, user._id);
  }

  @Post('verify-payment')
  @HttpCode(HttpStatus.OK)
  async verifyPayment(
    @Param('eventId') eventId: string,
    @Body() dto: VerifyEventRazorpayPaymentDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.verifyRazorpayPayment(
      eventId,
      dto,
      user._id,
    );
  }

  @Post('check-capacity')
  @HttpCode(HttpStatus.OK)
  async checkCapacity(
    @Param('eventId') eventId: string,
    @Body() dto: CheckEventCapacityDto,
  ) {
    return this.eventBookingService.checkCapacity(eventId, dto.playerCount);
  }

  @Get('me')
  async findMine(
    @Param('eventId') eventId: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.findMyBooking(eventId, user._id);
  }

  @Get()
  async findByEvent(
    @Param('eventId') eventId: string,
    @Query() filter: EventBookingFilterDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.findByEvent(
      eventId,
      user._id,
      user.role,
      filter,
    );
  }

  @Patch(':bookingId')
  async update(
    @Param('eventId') eventId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: UpdateEventBookingDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.updateBooking(
      eventId,
      bookingId,
      dto,
      user._id,
      user.role,
    );
  }
}
