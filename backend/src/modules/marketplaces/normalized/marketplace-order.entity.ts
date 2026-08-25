import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Marketplace } from '../core/marketplace.enum';

@Entity('marketplace_orders')
@Index(['tenant_id', 'marketplace_account_id', 'external_order_id'], { unique: true })
export class MarketplaceOrder {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenant_id: string;
  @Column({ type: 'uuid' }) marketplace_account_id: string;
  @Column({ type: 'varchar', length: 30 }) marketplace: Marketplace;
  @Column({ type: 'varchar', length: 300 }) external_order_id: string;
  @Column({ type: 'varchar', length: 80, nullable: true }) status: string | null;
  @Column({ type: 'char', length: 3, nullable: true }) currency_code: string | null;
  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true }) gross_total: string | null;
  @Column({ type: 'timestamptz' }) ordered_at: Date;
  @Column({ type: 'varchar', length: 40, default: 'SOURCE_ONLY' }) canonical_state: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
