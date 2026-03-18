import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { TurfService } from './turf.service';
import { CreateTurfDto, UpdateTurfDto } from './dto/turf.dto';
import { SearchTurfDto } from './dto/turf.filter.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as UserInterface from '../users/interfaces/user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('turf')
@UseGuards(JwtAuthGuard)
export class TurfController {
  constructor(private readonly turfService: TurfService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createTurfDto: CreateTurfDto,
    @CurrentUser() user: UserInterface.IUser,
  ) {
    const turf = await this.turfService.create(user._id, createTurfDto);
    return turf;
  }

  @Get()
  async findAll(@Query() query: SearchTurfDto) {
    const turfs = await this.turfService.searchTurfs(query);
    return turfs;
  }

  @Get('stats')
  async getStats() {
    const stats = await this.turfService.getStats();
    return stats;
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const turf = await this.turfService.findById(id);
    return turf;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateTurfDto: UpdateTurfDto) {
    return await this.turfService.update(id, updateTurfDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.turfService.delete(id);
    return {
      success: true,
      message: 'Turf deleted successfully',
    };
  }
}
