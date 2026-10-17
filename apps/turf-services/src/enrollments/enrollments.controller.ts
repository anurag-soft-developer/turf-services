import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  EnrollDto,
  EnrollmentListDto,
  WithdrawEnrollmentDto,
} from './dto/enrollment.dto';
import { EnrollmentsService } from './enrollments.service';

@Controller()
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Get('enrollments/me')
  findMine(
    @Query() query: EnrollmentListDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.enrollmentsService.findMine(userId.toString(), query);
  }

  @Post('openings/:id/enroll')
  @HttpCode(HttpStatus.CREATED)
  enroll(
    @Param('id') openingId: string,
    @Body() dto: EnrollDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.enrollmentsService.enroll(userId.toString(), openingId, dto);
  }

  @Delete('openings/:id/enroll')
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @Param('id') openingId: string,
    @Query() query: WithdrawEnrollmentDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    await this.enrollmentsService.withdraw(
      userId.toString(),
      openingId,
      query.teamId,
    );
    return { success: true };
  }

  @Get('openings/:id/enrollments')
  findForOpening(
    @Param('id') openingId: string,
    @Query() query: EnrollmentListDto,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.enrollmentsService.findForOpening(
      userId.toString(),
      openingId,
      query,
    );
  }

  @Post('openings/:id/enrollments/:enrollmentId/accept')
  accept(
    @Param('id') openingId: string,
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.enrollmentsService.accept(
      userId.toString(),
      openingId,
      enrollmentId,
    );
  }

  @Post('openings/:id/enrollments/:enrollmentId/reject')
  reject(
    @Param('id') openingId: string,
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser('_id') userId: Types.ObjectId,
  ) {
    return this.enrollmentsService.reject(
      userId.toString(),
      openingId,
      enrollmentId,
    );
  }
}
