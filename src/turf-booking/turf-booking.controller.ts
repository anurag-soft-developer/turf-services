import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { TurfBookingService } from './turf-booking.service';
import {
  UpdateTurfBookingDto,
  TurfBookingFilterDto,
  CheckTurfAvailabilityDto,
  TimeSlotsQueryDto,
  CreateBookingOrderDto,
  VerifyRazorpayPaymentDto,
} from './dto/turf-booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
@Controller('turf-bookings')
@UseGuards(JwtAuthGuard)
export class TurfBookingController {
  constructor(private readonly turfBookingService: TurfBookingService) {}


  @Post('create-order')
  @HttpCode(HttpStatus.CREATED)
  async createBookingOrder(
    @Body() createBookingDto: CreateBookingOrderDto,
    @CurrentUser('_id') userId: string,
  ) {
    return this.turfBookingService.createBookingOrder(
      createBookingDto,
      userId.toString(),
    );
  }

  @Post('verify-payment')
  @HttpCode(HttpStatus.OK)
  async verifyRazorpayPayment(
    @Body() verifyDto: VerifyRazorpayPaymentDto,
    @CurrentUser('_id') userId: string,
  ) {
    const booking = await this.turfBookingService.verifyRazorpayPayment(
      verifyDto,
      userId.toString(),
    );
    return booking;
  }

  @Get()
  async findAll(@Query() filterDto: TurfBookingFilterDto) {
    const result = await this.turfBookingService.findAll(filterDto);

    return result;
  }

  @Get('player-bookings')
  async findUserBookings(
    @CurrentUser('_id') userId: string,
    @Query() filterDto: TurfBookingFilterDto,
  ) {
    const result = await this.turfBookingService.findUserBookings(
      userId.toString(),
      filterDto,
    );

    return result;
  }

  @Get('owner-bookings')
  async findTurfOwnerBookings(
    @CurrentUser('_id') userId: string,
    @Query() filterDto: TurfBookingFilterDto,
  ) {
    const result = await this.turfBookingService.findTurfOwnerBookings(
      userId.toString(),
      filterDto,
    );

    return result;
  }

  @Get('turf/:turfId/time-slots')
  async getTimeSlots(
    @Param('turfId') turfId: string,
    @Query() query: TimeSlotsQueryDto,
  ) {
    return this.turfBookingService.getTimeSlotsForDate(turfId, query.date);
  }

  @Get('turf/:turfId')
  async findTurfBookings(
    @Param('turfId') turfId: string,
    @Query() filterDto: TurfBookingFilterDto,
  ) {
    const result = await this.turfBookingService.findTurfBookings(
      turfId,
      filterDto,
    );

    return result;
  }

  @Post('check-availability')
  @HttpCode(HttpStatus.OK)
  async checkAvailability(
    @Body() checkAvailabilityDto: CheckTurfAvailabilityDto,
  ) {
    const isAvailable =
      await this.turfBookingService.checkTimeSlotAvailability(
        checkAvailabilityDto,
      );

    return {
      success: true,
      message: 'Time slot is available',
      data: { isAvailable },
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const booking = await this.turfBookingService.findById(id);

    return booking;
  }

  @Patch(':id')
  async updateBooking(
    @Param('id') id: string,
    @Body() updateBookingDto: UpdateTurfBookingDto,
    @CurrentUser('_id') userId: string,
  ) {
    const booking = await this.turfBookingService.updateBooking(
      id,
      updateBookingDto,
      userId.toString(),
    );

    return booking;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBooking(
    @Param('id') id: string,
    @CurrentUser('_id') userId: string,
  ) {
    await this.turfBookingService.deleteBooking(id, userId);

    return {
      success: true,
      message: 'Booking deleted successfully',
    };
  }
}
