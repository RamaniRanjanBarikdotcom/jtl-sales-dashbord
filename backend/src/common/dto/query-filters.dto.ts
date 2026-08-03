import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class QueryFiltersDto {
  @IsOptional()
  @IsIn(['DAY', 'MONTH', 'PREVIOUS_MONTH', 'QUARTER', 'PREVIOUS_QUARTER', 'YEAR', 'PREVIOUS_YEAR', 'TODAY', 'YESTERDAY', '7D', '30D', '3M', '6M', '12M', '2Y', '5Y', 'YTD', 'ALL'])
  range?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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
  @MaxLength(64)
  channel?: string;

  @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean))
  @IsArray()
  @IsString({ each: true })
  channels?: string[];

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
  @Transform(({ value }) => Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean))
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  warehouse?: string;

  @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean))
  @IsArray()
  @IsString({ each: true })
  warehouses?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  performanceClass?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  stockStatus?: string;

  @IsOptional()
  @IsIn(['stock', 'alerts', 'dsi', 'demand', 'categories'])
  dataset?: string;

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
  shippingMethod?: string;

  @IsOptional()
  @IsIn(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  weekday?: string;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  orderNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  minStock?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  maxStock?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  minAvailable?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  maxAvailable?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  minReserved?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  maxReserved?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  minRevenue?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  maxRevenue?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  minDaysOfStock?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  maxDaysOfStock?: number;

  @IsOptional()
  @Transform(({ value }) => ['true', '1', true].includes(value))
  @IsBoolean()
  includeZeroSales?: boolean;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  productId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  productIds?: string;

  @IsOptional()
  @IsIn(['all', 'active', 'inactive'])
  catalogStatus?: string;

  @IsOptional()
  @IsIn(['all', 'with_sales', 'no_sales', 'with_stock', 'without_stock', 'stock_no_sales'])
  salesStatus?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
