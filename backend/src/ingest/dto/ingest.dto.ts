import { Transform, Type } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Safety metadata the sync engine attaches to inventory batches so the backend
// can refuse to overwrite good inventory with empty/unsafe/zero snapshots.
export class InventorySourceMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  inventorySourceMode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  selectedSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  stockStatus?: string;

  @IsOptional()
  @IsBoolean()
  safeToSync?: boolean;

  @IsOptional()
  @IsNumber()
  rowsRead?: number;

  @IsOptional()
  @IsNumber()
  rowsWithStock?: number;

  @IsOptional()
  @IsNumber()
  totalStock?: number;

  @IsOptional()
  @IsNumber()
  availableStock?: number;

  @IsOptional()
  @IsNumber()
  reservedStock?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectReason?: string;
}

export const VALID_SYNC_MODULES = [
  'orders',
  'order_items',
  'products',
  'customers',
  'inventory',
] as const;

export const VALID_TRIGGER_STATUS = ['running', 'completed', 'failed'] as const;
export const VALID_SYNC_MODES = ['incremental', 'full'] as const;

export class IngestDto {
  @IsIn(VALID_SYNC_MODULES)
  module!: (typeof VALID_SYNC_MODULES)[number];

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  tenantId!: string;

  @IsOptional()
  @Allow()
  rows?: unknown[];

  @IsOptional()
  @Allow()
  batchIndex?: number;

  @IsOptional()
  @Allow()
  totalBatches?: number;

  @IsOptional()
  @Allow()
  isLastBatch?: boolean;

  @IsOptional()
  @IsIn(VALID_SYNC_MODES)
  syncMode?: (typeof VALID_SYNC_MODES)[number];

  @IsOptional()
  @IsUUID()
  syncRunId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string;

  @IsOptional()
  @Allow()
  syncStartTime?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InventorySourceMetadataDto)
  sourceMetadata?: InventorySourceMetadataDto;
}

export class TriggerUpdateDto {
  @IsIn(VALID_TRIGGER_STATUS)
  status!: (typeof VALID_TRIGGER_STATUS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resultMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  errorMessage?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progressPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentBatch?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalBatches?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rowsSynced?: number;
}

export class EngineTriggerQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  tenantId?: string;
}
