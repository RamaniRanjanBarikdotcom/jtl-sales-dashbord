import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'bigint' })
  jtl_product_id: number;

  @Column({ length: 100, nullable: true })
  article_number: string;

  @Column({ length: 500 })
  name: string;

  @Column({ type: 'bigint', nullable: true })
  category_id: number;

  @Column({ length: 50, nullable: true })
  ean: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  unit_cost: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  list_price_net: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  list_price_gross: number;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'numeric', precision: 8, scale: 3, nullable: true })
  weight_kg: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  stock_quantity: number;

  @Column({ type: 'timestamptz', nullable: true })
  jtl_modified_at: Date;

  @CreateDateColumn()
  synced_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
