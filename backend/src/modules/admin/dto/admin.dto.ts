import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

const USER_ROLES = ['super_admin', 'admin', 'user'] as const;
const USER_LEVELS = ['viewer', 'analyst', 'manager'] as const;
export class TenantScopeQueryDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class PagedTenantScopeQueryDto extends TenantScopeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;
}

export class SyncLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;
}

export class CreateUserDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  full_name!: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: (typeof USER_ROLES)[number];

  @IsOptional()
  @IsIn(USER_LEVELS)
  user_level?: (typeof USER_LEVELS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dept?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  full_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: (typeof USER_ROLES)[number];

  @IsOptional()
  @IsIn(USER_LEVELS)
  user_level?: (typeof USER_LEVELS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dept?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  vat_rate?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  admin_password?: string;

  @IsOptional()
  @IsEmail()
  admin_email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  admin_name?: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  vat_rate?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ModuleParamDto {
  @IsIn(['orders', 'products', 'customers', 'inventory'])
  module!: 'orders' | 'products' | 'customers' | 'inventory';
}
