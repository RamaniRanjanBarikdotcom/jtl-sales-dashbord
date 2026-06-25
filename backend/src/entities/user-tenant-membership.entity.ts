import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_tenant_memberships')
@Index(['user_id'])
@Index(['tenant_id'])
@Index(['tenant_id', 'role'])
@Index(['user_id', 'tenant_id'], { unique: true })
export class UserTenantMembership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ length: 30, default: 'user' })
  role: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  user_level: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  dept: string | null;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deactivated_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deactivated_by: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
