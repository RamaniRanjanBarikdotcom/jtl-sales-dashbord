import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('marketplace_order_items')
@Index(['tenant_id', 'marketplace_account_id', 'external_order_id', 'external_item_id'], { unique: true })
export class MarketplaceOrderItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenant_id: string;
  @Column({ type: 'uuid' }) marketplace_account_id: string;
  @Column({ type: 'uuid' }) marketplace_order_id: string;
  @Column({ type: 'varchar', length: 300 }) external_order_id: string;
  @Column({ type: 'varchar', length: 300 }) external_item_id: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) external_product_id: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) sku: string | null;
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 0 }) quantity: string;
  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true }) gross_total: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
