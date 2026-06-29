import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

/**
 * @deprecated LEGACY user-scoped permission model. The authoritative source is
 * now `membership_permissions` (per UserTenantMembership). Retained only for the
 * admin permission-editor UI and as a defensive fallback; do not write new
 * enforcement against this table. Slated for removal via DB migration.
 */
@Entity('user_permissions')
@Unique(['user_id', 'permission_id'])
@Index(['user_id'])
export class UserPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  permission_id: string;

  @Column({ type: 'uuid', nullable: true })
  granted_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

