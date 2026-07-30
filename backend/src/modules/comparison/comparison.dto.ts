import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ComparisonQueryDto {
  @IsOptional()
  @IsIn(['channels', 'products', 'inventory', 'customers', 'orders'])
  dataset?: string;

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
  @IsIn(['none', 'previous_period', 'previous_year', 'custom'])
  compareMode?: string;

  @IsOptional()
  @IsDateString()
  compareFrom?: string;

  @IsOptional()
  @IsDateString()
  compareTo?: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month', 'quarter', 'year'])
  granularity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  channels?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  warehouse?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  segment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @IsOptional()
  @IsIn([
    'all',
    'zero_sales',
    'stock_no_sales',
    'growing',
    'declining',
    'fast_moving',
    'slow_moving',
    'dead_stock',
    'overstock',
    'stockout_risk',
    'new',
    'repeat',
    'at_risk',
  ])
  performance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
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
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  @Max(3650)
  deadStockDays?: number;
}

export class ProductCompareDto {
  @Transform(({ value }) => Array.isArray(value) ? value.map(Number) : [])
  @IsArray()
  productIds!: number[];

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class SavedViewDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(50)
  tab!: string;

  config!: Record<string, unknown>;
}
