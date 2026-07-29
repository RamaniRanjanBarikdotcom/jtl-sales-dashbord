import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AGENT_EVENT_TYPES } from '../../common/events/event-types';

export const LOG_SEVERITIES = ['debug', 'info', 'warning', 'error', 'critical'] as const;
export const LOG_SOURCES = [
  'backend', 'frontend', 'sync-engine', 'windows-service', 'database',
  'redis', 'authentication', 'admin', 'deployment',
] as const;

export class LogsQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsIn(LOG_SOURCES) source?: string;
  @IsOptional() @IsString() @MaxLength(80) module?: string;
  @IsOptional() @IsIn(LOG_SEVERITIES) severity?: string;
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsOptional() @IsString() @MaxLength(120) eventType?: string;
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsString() @MaxLength(150) agentId?: string;
  @IsOptional() @IsUUID() syncRunId?: string;
  @IsOptional() @IsUUID() commandId?: string;
  @IsOptional() @IsString() @MaxLength(128) correlationId?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(['live','sync','errors','security','infrastructure'])
  category?: 'live'|'sync'|'errors'|'security'|'infrastructure';
  @IsOptional() @IsIn(['occurredAt', 'severity', 'durationMs', 'rowsProcessed'])
  sortBy?: 'occurredAt' | 'severity' | 'durationMs' | 'rowsProcessed';
  @IsOptional() @IsIn(['asc', 'desc', 'ASC', 'DESC']) sortDirection?: string;
  @IsOptional() @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt() @Min(1) @Max(200) limit?: number;
}

export class LogsExportDto extends LogsQueryDto {
  @IsIn(['csv', 'json']) format!: 'csv' | 'json';
}

export class CreateAgentEventDto {
  @IsString() @MaxLength(150) agentId!: string;
  @IsDateString() occurredAt!: string;
  @IsIn(LOG_SEVERITIES) severity!: (typeof LOG_SEVERITIES)[number];
  @IsIn(AGENT_EVENT_TYPES) eventType!: (typeof AGENT_EVENT_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(80) module?: string;
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsString() @MaxLength(2000) message!: string;
  @IsOptional() @IsString() @MaxLength(128) correlationId?: string;
  @IsOptional() @IsUUID() syncRunId?: string;
  @IsOptional() @IsUUID() commandId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) rowsProcessed?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) durationMs?: number;
  @IsOptional() @IsString() @MaxLength(50) serviceVersion?: string;
  @IsOptional() @IsString() @MaxLength(64) gitSha?: string;
  @IsOptional() @IsString() @MaxLength(200) eventKey?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
