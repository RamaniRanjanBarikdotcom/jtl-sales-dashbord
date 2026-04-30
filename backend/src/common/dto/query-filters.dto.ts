import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class QueryFiltersDto {
  @IsOptional()
  @IsIn(['DAY', 'MONTH', 'YEAR', 'TODAY', 'YESTERDAY', '7D', '30D', '3M', '6M', '12M', '2Y', '5Y', 'YTD', 'ALL'])
  range?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  @IsOptional()
  @IsIn(['region', 'city', 'country'])
  locationDimension?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sort?: string;

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  order?: string;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @IsOptional()
  @IsIn(['all', 'with_invoice', 'without_invoice'])
  invoice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  orderNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
