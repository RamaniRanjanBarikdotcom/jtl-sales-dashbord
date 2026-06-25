import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

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

