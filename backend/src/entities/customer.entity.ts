import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'bigint' })
  jtl_customer_id: number;

  @Column({ length: 255, nullable: true })
  email: string;

  @Column({ length: 255, nullable: true })
  first_name: string;

  @Column({ length: 255, nullable: true })
  last_name: string;

  @Column({ length: 500, nullable: true })
  company: string;

  @Column({ length: 10, nullable: true })
  postcode: string;

  @Column({ length: 255, nullable: true })
  city: string;

  @Column({ length: 3, default: 'DE' })
  country_code: string;

  @Column({ length: 50, nullable: true })
  region: string;

  @Column({ default: 0 })
  total_orders: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_revenue: number;

  @Column({ type: 'date', nullable: true })
  first_order_date: Date;

  @Column({ type: 'date', nullable: true })
  last_order_date: Date;

  @Column({ nullable: true })
  days_since_last_order: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  ltv: number;

  @Column({ length: 20, nullable: true })
  segment: string;

  @Column({ length: 3, nullable: true })
  rfm_score: string;

  @Column({ type: 'timestamptz', nullable: true })
  jtl_modified_at: Date;

  @CreateDateColumn()
  synced_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
