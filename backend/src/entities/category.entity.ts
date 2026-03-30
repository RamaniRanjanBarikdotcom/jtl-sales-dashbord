import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'bigint' })
  jtl_category_id: number;

  @Column({ length: 500, nullable: true })
  name: string;

  @Column({ type: 'bigint', nullable: true })
  parent_id: number;

  @Column({ default: 1 })
  level: number;
}
