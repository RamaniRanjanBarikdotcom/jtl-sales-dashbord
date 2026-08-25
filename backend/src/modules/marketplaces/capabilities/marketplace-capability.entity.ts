import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { MarketplaceResource } from '../core/marketplace-resource.enum';
import { CapabilityLevel } from '../core/marketplace.types';

@Entity('marketplace_capabilities')
@Index(['tenant_id', 'marketplace_account_id', 'resource'], { unique: true })
export class MarketplaceCapability {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenant_id: string;
  @Column({ type: 'uuid' }) marketplace_account_id: string;
  @Column({ type: 'varchar', length: 40 }) resource: MarketplaceResource;
  @Column({ type: 'varchar', length: 30 }) level: CapabilityLevel;
  @Column({ type: 'varchar', length: 40, default: 'CONNECTOR' }) source: string;
  @Column({ type: 'text', nullable: true }) reason: string | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
