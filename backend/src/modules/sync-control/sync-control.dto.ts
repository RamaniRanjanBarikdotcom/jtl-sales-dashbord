import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject,
  IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';

export const SYNC_COMMAND_TYPES = [
  'RUN_DUE_SYNC', 'SYNC_ALL_INCREMENTAL',
  'RESYNC_INVENTORY', 'RESYNC_PRODUCTS', 'RESYNC_ORDERS', 'RESYNC_CUSTOMERS',
  'RESYNC_FULL', 'RUN_DIAGNOSTICS', 'TEST_JTL_CONNECTION',
  'TEST_BACKEND_CONNECTION', 'PAUSE_SCHEDULER', 'RESUME_SCHEDULER',
] as const;
export type SyncCommandType = (typeof SYNC_COMMAND_TYPES)[number];

export const COMMAND_PERMISSION: Record<SyncCommandType, string> = {
  RUN_DUE_SYNC: PERMISSIONS.SYNC_RUN_INCREMENTAL,
  SYNC_ALL_INCREMENTAL: PERMISSIONS.SYNC_RUN_INCREMENTAL,
  RESYNC_INVENTORY: PERMISSIONS.SYNC_RESYNC_INVENTORY,
  RESYNC_PRODUCTS: PERMISSIONS.SYNC_RESYNC_PRODUCTS,
  RESYNC_ORDERS: PERMISSIONS.SYNC_RESYNC_ORDERS,
  RESYNC_CUSTOMERS: PERMISSIONS.SYNC_RESYNC_CUSTOMERS,
  RESYNC_FULL: PERMISSIONS.SYNC_RESYNC_FULL,
  RUN_DIAGNOSTICS: PERMISSIONS.SYNC_DIAGNOSTICS,
  TEST_JTL_CONNECTION: PERMISSIONS.SYNC_DIAGNOSTICS,
  TEST_BACKEND_CONNECTION: PERMISSIONS.SYNC_DIAGNOSTICS,
  PAUSE_SCHEDULER: PERMISSIONS.SYNC_PAUSE,
  RESUME_SCHEDULER: PERMISSIONS.SYNC_RESUME,
};

export class SyncCommandPayloadDto {
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(100, { each: true })
  ids?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(100, { each: true })
  skus?: string[];
}

export class CreateSyncCommandDto {
  @IsString() @MaxLength(150) agentId!: string;
  @IsIn(SYNC_COMMAND_TYPES) commandType!: SyncCommandType;
  @IsOptional() @ValidateNested() @Type(() => SyncCommandPayloadDto) payload?: SyncCommandPayloadDto;
  @IsString() @MaxLength(200) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) priority?: number;
}

export class AgentHeartbeatDto {
  @IsString() @MaxLength(150) agentId!: string;
  @IsString() @MaxLength(150) displayName!: string;
  @IsOptional() @IsString() @MaxLength(150) machineName?: string;
  @IsOptional() @IsString() @MaxLength(50) serviceVersion?: string;
  @IsOptional() @IsString() @MaxLength(64) gitSha?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) protocolVersion?: number;
  @IsOptional() @IsIn(['running','idle','busy','paused','stopping','error']) schedulerState?: string;
  @IsOptional() @IsString() @MaxLength(100) currentJob?: string;
  @IsOptional() @IsUUID() currentCommandId?: string;
  @IsOptional() @IsIn(['connected','disconnected','unknown']) jtlConnectionStatus?: string;
  @IsOptional() @IsIn(['connected','disconnected','unknown']) backendConnectionStatus?: string;
  @IsOptional() @IsDateString() lastSuccessfulSyncAt?: string;
  @IsOptional() @IsDateString() nextScheduledSyncAt?: string;
  @IsOptional() @IsObject() capabilities?: Record<string, unknown>;
}

export class CommandProgressDto {
  @IsString() @MaxLength(150) agentId!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) progressPercent?: number;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsOptional() @IsInt() @Min(0) rowsProcessed?: number;
  @IsOptional() @IsInt() @Min(0) currentBatch?: number;
  @IsOptional() @IsInt() @Min(0) totalBatches?: number;
}

export class CommandResultDto {
  @IsString() @MaxLength(150) agentId!: string;
  @IsOptional() @IsObject() result?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(100) errorCode?: string;
  @IsOptional() @IsString() @MaxLength(2000) errorMessage?: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
}

export class ClaimCommandDto {
  @IsString() @MaxLength(150) agentId!: string;
}
