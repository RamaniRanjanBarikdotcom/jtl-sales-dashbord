import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { Marketplace } from '../core/marketplace.enum';
import { MarketplaceResource } from '../core/marketplace-resource.enum';

export class CreateMarketplaceAccountDto {
  @IsEnum(Marketplace) marketplace: Marketplace;
  @IsString() @Length(1, 160) displayName: string;
  @IsOptional() @IsString() @MaxLength(200) externalMerchantId?: string;
  @IsOptional() @IsString() @MaxLength(30) regionCode?: string;
  @IsOptional() @IsString() @Length(3, 3) currencyCode?: string;
  @IsObject() credentials: Record<string, unknown>;
}

export class UpdateMarketplaceAccountDto {
  @IsOptional() @IsString() @Length(1, 160) displayName?: string;
  @IsOptional() @IsString() @MaxLength(30) regionCode?: string;
  @IsOptional() @IsString() @Length(3, 3) currencyCode?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) paused?: boolean;
}

export class RotateMarketplaceCredentialDto {
  @IsObject() credentials: Record<string, unknown>;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

export class QueueMarketplaceSyncDto {
  @IsEnum(MarketplaceResource) resource: MarketplaceResource;
  @IsOptional() @IsISO8601() windowStart?: string;
  @IsOptional() @IsISO8601() windowEnd?: string;
}
