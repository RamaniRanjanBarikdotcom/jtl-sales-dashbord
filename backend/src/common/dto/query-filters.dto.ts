import { IsOptional, IsString, IsNumberString } from 'class-validator';

export class QueryFiltersDto {
  @IsOptional() @IsString() range?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() order?: string;
  @IsOptional() @IsNumberString() page?: string;
  @IsOptional() @IsNumberString() limit?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() tenantId?: string;
}
