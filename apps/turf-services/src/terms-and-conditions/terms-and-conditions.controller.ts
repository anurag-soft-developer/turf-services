import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles, UserRole } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { IUser } from '../users/interfaces/user.interface';
import {
  CreateTermsAndConditionsDto,
  TermsKindQueryDto,
  UpdateTermsAndConditionsDto,
} from './dto/terms-and-conditions.dto';
import { TermsAndConditionsService } from './terms-and-conditions.service';

@Controller('terms-and-conditions')
@UseGuards(JwtAuthGuard)
export class TermsAndConditionsController {
  constructor(
    private readonly termsAndConditionsService: TermsAndConditionsService,
  ) {}

  @Get('current')
  async getCurrent(@Query() query: TermsKindQueryDto) {
    return this.termsAndConditionsService.getCurrent(query.kind);
  }

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async listForAdmin(@Query() query: TermsKindQueryDto) {
    return this.termsAndConditionsService.listForAdmin(query.kind);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async createDraft(
    @CurrentUser() user: IUser,
    @Body() dto: CreateTermsAndConditionsDto,
  ) {
    return this.termsAndConditionsService.createDraft(user._id.toString(), dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async updateDraft(
    @Param('id') id: string,
    @Body() dto: UpdateTermsAndConditionsDto,
  ) {
    return this.termsAndConditionsService.updateDraft(id, dto);
  }

  @Post(':id/publish')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async publish(@Param('id') id: string, @CurrentUser() user: IUser) {
    return this.termsAndConditionsService.publish(id, user._id.toString());
  }
}
