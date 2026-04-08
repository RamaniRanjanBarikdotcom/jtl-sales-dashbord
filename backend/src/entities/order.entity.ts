import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('orders')
@Index(['tenant_id', 'order_date'])
@Index(['tenant_id', 'status', 'order_date'])
@Index(['tenant_id', 'channel', 'order_date'])
@Index(['tenant_id', 'region', 'order_date'])
export class Order {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'bigint' })
  jtl_order_id: number;

  @Column({ length: 50, nullable: true })
  order_number: string;

  @Column({ type: 'date' })
  order_date: Date;

  @Column({ type: 'bigint', nullable: true })
  customer_id: number;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  gross_revenue: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  net_revenue: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  shipping_cost: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  cost_of_goods: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  gross_margin: number;

  @Column({ length: 30, nullable: true })
  status: string;

  @Column({ length: 50, nullable: true })
  channel: string;

  @Column({ length: 50, nullable: true })
  region: string;

  @Column({ length: 10, nullable: true })
  postcode: string;

  @Column({ length: 255, nullable: true })
  city: string;

  @Column({ length: 100, nullable: true })
  country: string;

  @Column({ nullable: true })
  item_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  jtl_modified_at: Date;

  @Column({ length: 100, nullable: true })
  external_order_number: string;

  @Column({ length: 50, nullable: true })
  customer_number: string;

  @Column({ length: 100, nullable: true })
  payment_method: string;

  @Column({ length: 100, nullable: true })
  shipping_method: string;

  @CreateDateColumn()
  synced_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
