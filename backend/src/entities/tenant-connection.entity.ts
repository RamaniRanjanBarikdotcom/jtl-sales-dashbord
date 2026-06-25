import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('tenant_connections')
export class TenantConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  tenant_id: string;

  @Column({ length: 255 })
  sync_api_key_hash: string;

  @Column({ length: 10, nullable: true })
  sync_api_key_prefix: string;

  @Column({ type: 'timestamptz', nullable: true })
  sync_api_key_last_rotated: Date;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  last_ingest_at: Date;

  @Column({ length: 50, nullable: true })
  last_ingest_module: string;

  @Column({ type: 'timestamptz', nullable: true })
  last_attempt_at: Date;

  @Column({ length: 50, nullable: true })
  last_attempt_module: string;

  @Column({ type: 'timestamptz', nullable: true })
  last_success_at: Date;

  @Column({ length: 50, nullable: true })
  last_success_module: string;

  @Column({ type: 'timestamptz', nullable: true })
  last_failure_at: Date;

  @Column({ type: 'text', nullable: true })
  last_failure_message: string;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
