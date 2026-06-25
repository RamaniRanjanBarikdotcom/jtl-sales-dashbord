import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('order_items')
@Index(['tenant_id', 'order_id'])
@Index(['tenant_id', 'product_id'])
export class OrderItem {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'bigint' })
  jtl_item_id: number;

  @Column({ type: 'bigint', nullable: true })
  order_id: number;

  @Column({ type: 'bigint', nullable: true })
  product_id: number;

  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true })
  quantity: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  unit_price_gross: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  unit_price_net: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  unit_cost: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  line_total_gross: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  discount_pct: number;
}
