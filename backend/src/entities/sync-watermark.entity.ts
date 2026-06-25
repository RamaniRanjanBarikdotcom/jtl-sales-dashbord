import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Unique } from 'typeorm';

@Entity('sync_watermarks')
@Unique(['tenant_id', 'job_name'])
export class SyncWatermark {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ length: 50 })
  job_name: string;

  @Column({ type: 'timestamptz' })
  last_synced_at: Date;

  @Column({ default: 0 })
  last_row_count: number;

  @UpdateDateColumn()
  updated_at: Date;
}
