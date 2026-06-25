import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory')
export class Inventory {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'bigint' })
  jtl_product_id: number;

  @Column({ type: 'bigint' })
  jtl_warehouse_id: number;

  @Column({ type: 'bigint', nullable: true })
  product_id: number;

  @Column({ length: 255, nullable: true })
  warehouse_name: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  available: number;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  reserved: number;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  total: number;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  reorder_point: number;

  @Column({ default: false })
  is_low_stock: boolean;

  @Column({ nullable: true })
  days_of_stock: number;

  @CreateDateColumn()
  synced_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
