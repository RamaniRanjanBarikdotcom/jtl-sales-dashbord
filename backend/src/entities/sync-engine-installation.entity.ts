import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('sync_engine_installations')
@Index(['tenant_id'])
@Index(['tenant_id', 'machine_id'], { unique: true })
export class SyncEngineInstallation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ length: 100 })
  machine_id: string;

  @Column({ length: 255, nullable: true })
  machine_name: string;

  @Column({ length: 50, nullable: true })
  engine_version: string;

  @Column({ length: 100, nullable: true })
  os_version: string;

  @Column({ type: 'timestamptz', nullable: true })
  last_seen_at: Date;

  @Column({ type: 'inet', nullable: true })
  last_ip: string;

  @Column({ length: 30, default: 'unknown' })
  status: 'unknown' | 'online' | 'offline' | 'running' | 'idle' | 'not_installed' | 'outdated' | 'error';

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
