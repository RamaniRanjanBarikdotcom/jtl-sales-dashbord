import { Allow, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const VALID_SYNC_MODULES = [
  'orders',
  'order_items',
  'products',
  'customers',
  'inventory',
] as const;

export const VALID_TRIGGER_STATUS = ['pending', 'picked', 'done', 'failed'] as const;

export class IngestDto {
  @IsIn(VALID_SYNC_MODULES)
  module!: (typeof VALID_SYNC_MODULES)[number];

  @IsOptional()
  @IsUUID()
  tenantId?: string;

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
  @Allow()
  syncStartTime?: string;
}

export class TriggerUpdateDto {
  @IsUUID()
  tenantId!: string;

  @IsIn(VALID_TRIGGER_STATUS)
  status!: (typeof VALID_TRIGGER_STATUS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resultMessage?: string;
}

export class EngineTriggerQueryDto {
  @IsUUID()
  tenantId!: string;
}
