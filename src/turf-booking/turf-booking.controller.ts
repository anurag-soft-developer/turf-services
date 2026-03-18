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
  CreateTurfBookingDto,
  UpdateTurfBookingDto,
  TurfBookingFilterDto,
  CheckTurfAvailabilityDto,
} from './dto/turf-booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('turf-bookings')
@UseGuards(JwtAuthGuard)
export class TurfBookingController {
  constructor(private readonly turfBookingService: TurfBookingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createBooking(
    @Body() createBookingDto: CreateTurfBookingDto,
    @CurrentUser('_id') userId: string,
  ) {
    const booking = await this.turfBookingService.createBooking(
      createBookingDto,
      userId,
    );

    return booking;
  }

  @Get()
  async findAll(@Query() filterDto: TurfBookingFilterDto) {
    const result = await this.turfBookingService.findAll(filterDto);

    return result;
  }

  @Get('my-bookings')
  async findUserBookings(
    @CurrentUser('_id') userId: string,
    @Query() filterDto: Partial<TurfBookingFilterDto>,
  ) {
    const result = await this.turfBookingService.findUserBookings(
      userId,
      filterDto,
    );

    return result;
  }

  @Get('my-turf-bookings')
  async findTurfOwnerBookings(
    @CurrentUser('_id') userId: string,
    @Query() filterDto: Partial<TurfBookingFilterDto>,
  ) {
    const result = await this.turfBookingService.findTurfOwnerBookings(
      userId,
      filterDto,
    );

    return result;
  }

  @Get('turf/:turfId')
  async findTurfBookings(
    @Param('turfId') turfId: string,
    @Query() filterDto: Partial<TurfBookingFilterDto>,
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
      userId,
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
