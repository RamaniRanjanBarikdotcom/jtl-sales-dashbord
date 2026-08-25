import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Marketplace } from '../core/marketplace.enum';

export type MarketplaceAccountStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'AUTH_EXPIRED'
  | 'DISABLED';

@Entity('marketplace_accounts')
@Index(['tenant_id', 'marketplace', 'external_merchant_id'], { unique: true })
@Index(['tenant_id', 'status'])
export class MarketplaceAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 30 })
  marketplace: Marketplace;

  @Column({ type: 'varchar', length: 160 })
  display_name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  external_merchant_id: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  region_code: string | null;

  @Column({ type: 'char', length: 3, nullable: true })
  currency_code: string | null;

  @Column({ type: 'varchar', length: 30, default: 'DRAFT' })
  status: MarketplaceAccountStatus;

  @Column({ type: 'boolean', default: false })
  shadow_mode: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  last_connection_test_at: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  last_connection_status: string | null;

  @Column({ type: 'text', nullable: true })
  last_safe_error: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
