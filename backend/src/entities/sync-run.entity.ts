import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sync_runs')
@Index(['tenant_id', 'started_at'])
@Index(['tenant_id', 'module', 'started_at'])
export class SyncRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ length: 50 })
  module: string;

  @Column({ length: 30, default: 'incremental' })
  sync_mode: 'incremental' | 'full';

  @Column({ length: 30, default: 'scheduled' })
  trigger_type: 'manual' | 'scheduled' | 'bootstrap';

  @Column({ length: 30 })
  status: 'queued' | 'running' | 'ok' | 'failed' | 'partial_failed' | 'cancelled';

  @Column({ type: 'timestamptz' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  failed_at: Date;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @Column({ default: 0 })
  total_rows: number;

  @Column({ default: 0 })
  inserted_rows: number;

  @Column({ default: 0 })
  updated_rows: number;

  @Column({ default: 0 })
  deleted_rows: number;

  @Column({ type: 'timestamptz', nullable: true })
  created_at: Date;
}
