import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('sync_log')
@Index(['tenant_id', 'started_at'])
export class SyncLog {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ length: 50 })
  job_name: string;

  @Column({ length: 20 })
  trigger_type: string;

  @Column({ length: 10 })
  status: string;

  @Column({ default: 0 })
  rows_extracted: number;

  @Column({ default: 0 })
  rows_inserted: number;

  @Column({ default: 0 })
  rows_updated: number;

  @Column({ nullable: true })
  duration_ms: number;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @Column({ type: 'timestamptz' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;
}
