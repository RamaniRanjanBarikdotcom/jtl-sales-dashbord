import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ChannelPaymentPreviewDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number = 100;
}

export class ChannelPaymentBackfillDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit!: number;
  @IsOptional() @IsUUID() runId?: string;
  @IsString() @MaxLength(80) confirmation!: string;
}

export class ChannelPaymentRollbackDto {
  @IsUUID() runId!: string;
  @IsString() @MaxLength(80) confirmation!: string;
}

export class ChannelPaymentRuleDecisionDto {
  @IsIn(['verified', 'rejected']) evidenceStatus!: 'verified' | 'rejected';
  @IsBoolean() enabled!: boolean;
  @IsString() @MaxLength(2000) evidenceReference!: string;
  @IsString() @MaxLength(80) confirmation!: string;
}

export class ChannelPaymentActivationDto {
  @IsIn(['channel', 'payment']) feature!: 'channel' | 'payment';
  @IsBoolean() enabled!: boolean;
  @IsString() @MaxLength(80) confirmation!: string;
}
