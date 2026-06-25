import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100, unique: true })
  slug: string;

  @Column({ default: true })
  is_active: boolean;

  @Column({ length: 50, default: 'Europe/Berlin' })
  timezone: string;

  @Column({ length: 3, default: 'EUR' })
  currency: string;

  @Column({ type: 'numeric', precision: 5, scale: 4, default: 0.19 })
  vat_rate: number;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @Column({ type: 'timestamptz', nullable: true })
  deactivated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  deactivated_by: string;

  @Column({ type: 'timestamptz', nullable: true })
  reactivated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  reactivated_by: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
