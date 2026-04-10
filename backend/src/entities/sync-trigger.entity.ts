import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('sync_triggers')
@Index(['tenant_id', 'status'])
export class SyncTrigger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ length: 50 })
  module: string;

  @Column({ length: 20, default: 'pending' })
  status: string;  // pending | picked | done | failed

  @Column({ type: 'uuid', nullable: true })
  triggered_by: string;

  @Column({ type: 'text', nullable: true })
  result_message: string;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  picked_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;
}
