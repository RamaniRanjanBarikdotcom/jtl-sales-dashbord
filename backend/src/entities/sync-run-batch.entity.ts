import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sync_run_batches')
@Index(['sync_run_id', 'batch_index'], { unique: true })
export class SyncRunBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sync_run_id: string;

  @Column({ type: 'uuid', nullable: true })
  tenant_id: string;

  @Column({ length: 50, nullable: true })
  module: string;

  @Column()
  batch_index: number;

  @Column({ default: 1 })
  total_batches: number;

  @Column({ length: 128, nullable: true })
  checksum: string;

  @Column({ default: 0 })
  row_count: number;

  @Column({ default: 0 })
  inserted_rows: number;

  @Column({ default: 0 })
  updated_rows: number;

  @Column({ length: 30 })
  status: 'queued' | 'processing' | 'running' | 'ok' | 'failed' | 'dead_letter';

  @Column({ type: 'timestamptz', nullable: true })
  queued_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  failed_at: Date;

  @Column({ nullable: true })
  duration_ms: number;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @Column({ type: 'timestamptz', nullable: true })
  created_at: Date;
}
