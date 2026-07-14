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
  CreateOrderQueryDto,
  EventBookingFilterDto,
  UpdateEventBookingDto,
  VerifyEventRazorpayHostedPaymentDto,
  VerifyEventRazorpayPaymentDto,
  CheckEventCapacityDto,
} from './dto/event-booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as UserInterface from '../users/interfaces/user.interface';

@Controller('event-bookings')
@UseGuards(JwtAuthGuard)
export class EventBookingController {
  constructor(private readonly eventBookingService: EventBookingService) {}

  @Post('events/:eventId/create-order')
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @Param('eventId') eventId: string,
    @Body() dto: CreateEventBookingDto,
    @Query() query: CreateOrderQueryDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.createBookingOrder(
      eventId,
      dto,
      user,
      query.paymentLink ?? false,
    );
  }

  @Post('events/:eventId/verify-payment')
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

  @Post('events/:eventId/verify-hosted-payment')
  @HttpCode(HttpStatus.OK)
  async verifyHostedPayment(
    @Param('eventId') eventId: string,
    @Body() dto: VerifyEventRazorpayHostedPaymentDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.verifyHostedPayment(eventId, dto, user._id);
  }

  @Post('events/:eventId/check-capacity')
  @HttpCode(HttpStatus.OK)
  async checkCapacity(
    @Param('eventId') eventId: string,
    @Body() dto: CheckEventCapacityDto,
  ) {
    return this.eventBookingService.checkCapacity(eventId, dto.playerCount);
  }

  @Get('events/:eventId/me')
  async findMine(
    @Param('eventId') eventId: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.findMyBooking(eventId, user._id);
  }

  @Get('events/:eventId')
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

  @Patch('events/:eventId/:bookingId')
  async updateByEvent(
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

  @Get('user-bookings')
  async findUserBookings(
    @CurrentUser('_id') userId: string,
    @Query() filter: EventBookingFilterDto,
  ) {
    return this.eventBookingService.findUserBookings(userId.toString(), filter);
  }

  @Get('owner-bookings')
  async findOrganizerBookings(
    @CurrentUser('_id') userId: string,
    @Query() filter: EventBookingFilterDto,
  ) {
    return this.eventBookingService.findOrganizerBookings(
      userId.toString(),
      filter,
    );
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.findOrganizerBookingById(
      id,
      user._id.toString(),
      user.role,
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEventBookingDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    return this.eventBookingService.updateOrganizerBooking(
      id,
      dto,
      user._id.toString(),
      user.role,
    );
  }
}
