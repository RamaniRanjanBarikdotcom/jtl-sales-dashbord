import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('inventory_staging')
@Index(['sync_run_id'])
@Index(['tenant_id', 'jtl_product_id', 'jtl_warehouse_id'])
export class InventoryStaging {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  sync_run_id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'bigint' })
  jtl_product_id: number;

  @Column({ type: 'bigint' })
  jtl_warehouse_id: number;

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

  @Column({ type: 'timestamptz' })
  created_at: Date;
}
