import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Marketplace } from '../core/marketplace.enum';
import { MarketplaceResource } from '../core/marketplace-resource.enum';

@Entity('marketplace_raw_entities')
@Index(['tenant_id', 'marketplace_account_id', 'resource', 'external_id'], { unique: true })
export class MarketplaceRawEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenant_id: string;
  @Column({ type: 'uuid' }) marketplace_account_id: string;
  @Column({ type: 'varchar', length: 30 }) marketplace: Marketplace;
  @Column({ type: 'varchar', length: 40 }) resource: MarketplaceResource;
  @Column({ type: 'varchar', length: 300 }) external_id: string;
  @Column({ type: 'varchar', length: 40 }) payload_hash: string;
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  @Column({ type: 'varchar', length: 40 }) connector_version: string;
  @Column({ type: 'varchar', length: 40 }) normalizer_version: string;
  @Column({ type: 'timestamptz', nullable: true }) source_updated_at: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) first_seen_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) last_seen_at: Date;
}
