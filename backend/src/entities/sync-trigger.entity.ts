import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('sync_triggers')
@Index(['tenant_id', 'status'])
@Index(['tenant_id', 'module', 'status'])
@Index(['engine_id', 'status'])
export class SyncTrigger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ length: 50 })
  module: string;

  @Column({ length: 30, default: 'incremental' })
  sync_mode: 'incremental' | 'full';

  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({ length: 20, default: 'pending' })
  status: 'pending' | 'picked' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';

  @Column({ type: 'uuid', nullable: true })
  triggered_by: string;

  @Column({ type: 'uuid', nullable: true })
  requested_by: string;

  @Column({ length: 100, nullable: true })
  engine_id: string;

  @Column({ type: 'int', default: 0 })
  progress_percent: number;

  @Column({ type: 'int', nullable: true })
  current_batch: number;

  @Column({ type: 'int', nullable: true })
  total_batches: number;

  @Column({ type: 'int', default: 0 })
  rows_synced: number;

  @Column({ type: 'text', nullable: true })
  result_message: string;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  picked_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  failed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date;
}
