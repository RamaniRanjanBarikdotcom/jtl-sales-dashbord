import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('users')
@Index(['tenant_id', 'role'])
@Index(['email'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * @deprecated The selected tenant now comes from the x-tenant-id header /
   * UserTenantMembership, not from this column. Kept for legacy single-tenant
   * fallbacks only.
   */
  @Column({ type: 'uuid', nullable: true })
  tenant_id: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 255 })
  password_hash: string;

  @Column({ length: 255 })
  full_name: string;

  // TODO(global_role): rename to `global_role` via DB migration — this is the
  // platform-level role (super_admin | admin | user). Per-company role lives on
  // UserTenantMembership.role.
  @Column({ length: 20 })
  role: string; // super_admin | admin | user

  /**
   * @deprecated Per-company level now lives on UserTenantMembership.user_level.
   */
  @Column({ length: 20, nullable: true })
  user_level: string; // viewer | analyst | manager

  /**
   * @deprecated Per-company department now lives on UserTenantMembership.dept.
   */
  @Column({ length: 100, nullable: true })
  dept: string;

  @Column({ default: true })
  is_active: boolean;

  @Column({ default: true })
  must_change_pwd: boolean;

  @Column({ default: 0 })
  failed_login_attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  locked_until: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_login_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @Column({ type: 'jsonb', nullable: true })
  preferences: Record<string, any> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
