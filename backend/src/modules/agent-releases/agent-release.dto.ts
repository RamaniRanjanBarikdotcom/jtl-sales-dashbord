import {
  IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID,
  IsObject, Matches, Max, MaxLength, Min,
} from 'class-validator';

export class CreateAgentReleaseDto {
  @IsIn(['stable', 'beta']) channel!: string;
  @Matches(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/) version!: string;
  @Matches(/^[0-9a-f]{7,64}$/i) gitSha!: string;
  @IsInt() @Min(1) @Max(100) protocolVersion!: number;
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.zip$/) packageFileName!: string;
  @Matches(/^[0-9A-Fa-f]{40,128}$/) publisherThumbprint!: string;
  @IsOptional() @Matches(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/) minimumSupportedVersion?: string;
  @IsOptional() @IsString() @MaxLength(10_000) releaseNotes?: string;
  @IsOptional() @IsInt() @Min(30) @Max(900) healthTimeoutSeconds?: number;
  @IsOptional() @IsBoolean() requiresServiceRestart?: boolean;
  @IsOptional() @IsBoolean() requiresMachineRestart?: boolean;
}

export class RequestAgentUpdateDto {
  @IsUUID() releaseId!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
  @IsOptional() @IsIn(['now', 'maintenance']) installMode?: 'now'|'maintenance';
  @IsOptional() @IsBoolean() retryFailed?: boolean;
}

export const UPDATE_PROGRESS_STATUSES = [
  'downloading','verifying','staged','waiting_for_window','installing',
  'restarting','verifying_health','rollback_started',
] as const;

export class AgentUpdateProgressDto {
  @IsString() @IsNotEmpty() agentId!: string;
  @IsIn(UPDATE_PROGRESS_STATUSES) status!: typeof UPDATE_PROGRESS_STATUSES[number];
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsOptional() @IsString() @MaxLength(100) eventType?: string;
  @IsOptional() @IsObject() result?: Record<string, unknown>;
}

export class AgentUpdateResultDto {
  @IsString() @IsNotEmpty() agentId!: string;
  @IsOptional() @IsString() @MaxLength(100) errorCode?: string;
  @IsOptional() @IsString() @MaxLength(4000) errorMessage?: string;
  @IsOptional() @IsObject() result?: Record<string, unknown>;
}

export class ClaimAgentUpdateDto {
  @IsString() @IsNotEmpty() agentId!: string;
  @IsString() @IsNotEmpty() currentVersion!: string;
  @IsString() @IsNotEmpty() currentGitSha!: string;
}
