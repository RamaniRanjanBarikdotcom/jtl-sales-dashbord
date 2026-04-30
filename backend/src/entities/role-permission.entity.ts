import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

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

