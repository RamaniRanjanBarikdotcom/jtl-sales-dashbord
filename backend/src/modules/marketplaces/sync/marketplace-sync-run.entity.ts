import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Marketplace } from '../core/marketplace.enum';
import { MarketplaceResource } from '../core/marketplace-resource.enum';
import { MarketplaceSyncTrigger } from '../core/marketplace.types';

@Entity('marketplace_sync_runs')
@Index(['tenant_id', 'marketplace_account_id', 'created_at'])
export class MarketplaceSyncRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenant_id: string;
  @Column({ type: 'uuid' }) marketplace_account_id: string;
  @Column({ type: 'varchar', length: 30 }) marketplace: Marketplace;
  @Column({ type: 'varchar', length: 40 }) resource: MarketplaceResource;
  @Column({ type: 'varchar', length: 30 }) trigger: MarketplaceSyncTrigger;
  @Column({ type: 'varchar', length: 30, default: 'QUEUED' }) status: string;
  @Column({ type: 'boolean', default: true }) shadow_mode: boolean;
  @Column({ type: 'integer', default: 1 }) protocol_version: number;
  @Column({ type: 'integer', default: 0 }) records_seen: number;
  @Column({ type: 'integer', default: 0 }) records_written: number;
  @Column({ type: 'timestamptz', nullable: true }) started_at: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) completed_at: Date | null;
  @Column({ type: 'text', nullable: true }) safe_error: string | null;
  @Column({ type: 'uuid', nullable: true }) requested_by: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}
