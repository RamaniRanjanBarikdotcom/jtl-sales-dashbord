import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('marketplace_order_links')
@Index(['tenant_id', 'marketplace_order_id'], { unique: true })
export class MarketplaceOrderLink {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenant_id: string;
  @Column({ type: 'uuid' }) marketplace_order_id: string;
  @Column({ type: 'bigint', nullable: true }) jtl_order_id: string | null;
  @Column({ type: 'date', nullable: true }) jtl_order_date: string | null;
  @Column({ type: 'varchar', length: 30 }) status: string;
  @Column({ type: 'numeric', precision: 6, scale: 5, nullable: true }) confidence: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) evidence: Record<string, unknown>;
  @Column({ type: 'uuid', nullable: true }) resolved_by: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
