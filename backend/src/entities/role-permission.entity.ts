import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

/**
 * @deprecated LEGACY global role→permission defaults. Tenant-scoped access is
 * now driven by `membership_permissions`. Retained only as a fallback for the
 * legacy user-scoped model. Slated for removal via DB migration.
 */
@Entity('role_permissions')
@Unique(['role', 'permission_id'])
@Index(['role'])
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 30 })
  role: string;

  @Column({ type: 'uuid' })
  permission_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

