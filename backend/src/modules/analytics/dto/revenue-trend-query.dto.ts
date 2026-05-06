import { IsIn, IsOptional } from 'class-validator';
import { QueryFiltersDto } from '../../../common/dto/query-filters.dto';

export type RevenueTrendGranularity = 'year' | 'month' | 'day';
export type RevenueTrendCompare = 'none' | 'prior_year';

export class RevenueTrendQueryDto extends QueryFiltersDto {
  @IsOptional()
  @IsIn(['year', 'month', 'day'])
  granularity?: RevenueTrendGranularity;

  @IsOptional()
  @IsIn(['none', 'prior_year'])
  compare?: RevenueTrendCompare;
}
