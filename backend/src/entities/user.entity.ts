import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('users')
@Index(['tenant_id', 'role'])
@Index(['email'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  tenant_id: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 255 })
  password_hash: string;

  @Column({ length: 255 })
  full_name: string;

  @Column({ length: 20 })
  role: string; // super_admin | admin | user

  @Column({ length: 20, nullable: true })
  user_level: string; // viewer | analyst | manager

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
