import { 
  IsOptional, 
  IsString, 
  IsNumber, 
  Min, 
  Max, 
  IsArray, 
  IsBoolean,
  IsLatitude,
  IsLongitude,
  ValidateNested,
  Matches
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class LocationFilterDto {
  @IsOptional()
  @IsLatitude()
  @Transform(({ value }) => parseFloat(value))
  lat?: number;

  @IsOptional()
  @IsLongitude()
  @Transform(({ value }) => parseFloat(value))
  lng?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  radius?: number = 10;
}

export class PricingFilterDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  minPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  maxPrice?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  includeWeekendSurge?: boolean;
}

export class SearchTurfDto {
  @IsOptional()
  @IsString()
  globalSearchText?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',').map(v => v.trim());
    }
    return value;
  })
  sportTypes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',').map(v => v.trim());
    }
    return value;
  })
  amenities?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationFilterDto)
  location?: LocationFilterDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingFilterDto)
  pricing?: PricingFilterDto;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  isAvailable?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  @Transform(({ value }) => parseFloat(value))
  minRating?: number;

  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Operating time must be in HH:mm format',
  })
  operatingTime?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;

  @IsOptional()
  @IsString()
  sort?: string;
}